#!/usr/bin/env python3
"""Prepare seven credential-free Docker contexts from one reviewed main commit.

No worktree file, dotenv file, local dependency, Git credential, or gitignored
artifact is copied. Credential checks are deliberately conservative and are not
an assertion that arbitrary source code is free of secrets. A flagged required
source file must be reviewed and fixed upstream, never silently rewritten.
"""

import argparse
import ast
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import urlopen


ROOTS = {
    "backend": "event-checkin/backend",
    "frontend": "event-checkin/frontend",
    "marketing": "event-checkin/marketing-service",
    "dashboard": "event-checkin/dashboard-service",
    "support": "event-checkin/support-service",
    "messaging": "event-checkin/messaging-service",
    "setup": "event-checkin/setup-service",
}
FIREBASE_KEYS = (
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
)
SUPPORT_CHAT_KEYS = ("VITE_CHATWOOT_BASE_URL", "VITE_CHATWOOT_WEBSITE_TOKEN")
PUBLIC_FRONTEND_KEYS = FIREBASE_KEYS + SUPPORT_CHAT_KEYS
FRONTEND_FILES = {
    "Dockerfile.scoped-release", "package.json", "package-lock.json",
    "index.html", "nginx.conf", "vite.config.js", "tailwind.config.js",
    "postcss.config.js", "jsconfig.json", "scripts/gen-guide-html.mjs",
}
SOURCE_SUFFIXES = {".js", ".jsx", ".mjs", ".ts", ".tsx", ".json", ".css", ".md"}
ASSET_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico", ".pdf",
    ".html", ".js", ".css", ".webmanifest", ".md", ".pptx", ".woff",
    ".woff2", ".ttf",
}
GENERATED_DIRS = {
    "node_modules", "dist", "build", "coverage", "__pycache__",
    "playwright-report", "test-results", "venv", "env",
}
SENSITIVE_NAME = re.compile(
    r"(?:^|[_. -])(?:secrets?|credentials?|passwords?|tokens?)(?:[_. -]|$)"
    r"|service[_. -]?account|private[_. -]?key|^id_(?:rsa|dsa|ecdsa|ed25519)"
)
CREDENTIAL_URL = re.compile(
    rb"(?i)(?:postgres(?:ql)?(?:\+[a-z0-9_]+)?|mysql(?:\+[a-z0-9_]+)?|"
    rb"rediss?|amqps?|mongodb(?:\+srv)?|(?:git\+)?https?)://[^\s:/@'\"]+:[^\s/@'\"]+@"
)
SECRET_CONTENT = (
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
    re.compile(rb'"type"\s*:\s*"service_account"'),
    re.compile(rb"(?i)(?:_authToken|aws_secret_access_key)\s*[=:]\s*[^\s]+"),
    re.compile(rb"(?i)(?:git\+)?https?://[^\s/@'\"]+@"),
    re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,})\b"),
)
SUPPORT_FILES = {
    "app/knowledge_base.md", "app/support_policy.md",
    "scripts/bootstrap_chatwoot.sh", "scripts/build_knowledge_base.mjs",
    "scripts/chatwoot_bootstrap.rb", "scripts/dead_letter.py",
    "scripts/evaluate.py", "scripts/staging_smoke.py",
    "scripts/verify_chatwoot_bootstrap.py", "evaluation/questions.jsonl",
}
REQUIRED = {
    "backend": {"Dockerfile", "requirements.txt", "app/main.py", "app/config.py", "services/__init__.py"},
    "frontend": FRONTEND_FILES - {"jsconfig.json", "Dockerfile.scoped-release"}
        | {"Dockerfile", "src/main.jsx", "src/firebase.js", "src/guideContent.mjs", "src/lib/chatWidget.mjs"},
    "marketing": {"Dockerfile", "requirements.txt", "app/main.py"},
    "dashboard": {"Dockerfile", "requirements.txt", "app/__init__.py", "app/main.py",
                  "app/auth.py", "app/config.py", "app/database.py", "app/models.py", "app/timeutil.py"},
    "support": {"Dockerfile", "requirements.txt", "app/__init__.py", "app/main.py"} | SUPPORT_FILES,
    "messaging": {"Dockerfile", "requirements.txt", "app/__init__.py", "app/main.py"},
    "setup": {"Dockerfile", "requirements.txt", "app/__init__.py", "app/main.py", "app/recommendations.py"},
}
# COPY sources are an explicit contract. New Dockerfile inputs require review,
# rather than disappearing from a sanitized context or importing arbitrary files.
COPY_SOURCES = {
    "backend": {"requirements.txt", "app/", "services/", "fonts/"},
    "frontend": {"package.json", "package-lock.json", ".", "nginx.conf"},
    "marketing": {"requirements.txt", "app/"},
    "dashboard": {"requirements.txt", "app/"},
    "support": {"requirements.txt", "app/", "scripts/", "evaluation/"},
    "messaging": {"requirements.txt", "app/"},
    "setup": {"requirements.txt", "app/"},
}
SETTINGS_FILES = {
    "backend": "app/config.py", "dashboard": "app/config.py",
    "support": "app/main.py", "messaging": "app/main.py", "setup": "app/main.py",
}


class ReleaseError(ValueError):
    pass


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.PIPE)


def validate_source(repo, expected_sha, version, environ):
    if not re.fullmatch(r"[0-9a-f]{40}", expected_sha):
        raise ReleaseError("Expected source must be a full lowercase commit SHA.")
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version):
        raise ReleaseError("Release version must be an unprefixed numeric X.Y.Z.")
    if environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or environ.get("GITHUB_REF") != "refs/heads/main":
        raise ReleaseError("Only a manual dispatch from main is permitted.")
    for actual in (
        environ.get("GITHUB_SHA"),
        git(repo, "rev-parse", "HEAD").decode().strip(),
        git(repo, "rev-parse", "refs/remotes/origin/main").decode().strip(),
    ):
        if actual != expected_sha:
            raise ReleaseError("Dispatch, checkout, and current fetched main must equal the reviewed source SHA.")
    committed_version = git(repo, "show", f"{expected_sha}:event-checkin/VERSION").decode().strip()
    if committed_version != version:
        raise ReleaseError("Requested version does not equal the committed event-checkin/VERSION.")


def validate_public_config(environ):
    invalid = [name for name in PUBLIC_FRONTEND_KEYS if not environ.get(name)
               or any(char.isspace() or ord(char) < 32 for char in environ[name])]
    # Existing support embed identifiers are public browser configuration, not
    # Chatwoot API/HMAC credentials. Never substitute the anonymous sales inbox.
    base_key, token_key = SUPPORT_CHAT_KEYS
    if base_key not in invalid:
        try:
            url = urlsplit(environ[base_key])
            hostname = (url.hostname or "").removesuffix(".")
            # Accept canonical IP literals and DNS names, not ambiguous browser
            # numeric-host syntax or characters WHATWG URL would reject later.
            if "[" in url.netloc or "]" in url.netloc:
                ipaddress.IPv6Address(hostname)  # WHATWG does not accept IPvFuture hosts.
            elif ":" in hostname or re.fullmatch(r"[0-9.]+", hostname):
                ipaddress.ip_address(hostname)
            elif (not all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
                          for label in hostname.split("."))
                  or re.fullmatch(r"(?:[0-9]+|0[xX][A-Fa-f0-9]*)", hostname.split(".")[-1])):
                raise ValueError("Invalid support origin hostname")
            if (url.scheme != "https" or not url.hostname or url.username or url.password
                    or url.query or url.fragment or url.path.strip("/")
                    or "\\" in environ[base_key] or "%" in environ[base_key]
                    or "@" in url.netloc or url.port is not None and not 1 <= url.port <= 65535):
                invalid.append(base_key)
        except ValueError:
            invalid.append(base_key)
    if token_key not in invalid and not re.fullmatch(r"[A-Za-z0-9_-]{8,200}", environ[token_key]):
        invalid.append(token_key)
    if invalid:
        # Names only. Never echo values, including values accidentally supplied as secrets.
        raise ReleaseError("Missing or invalid public frontend repository variables: " + ", ".join(invalid))


def allowed(service, relative):
    path = PurePosixPath(relative)
    if service not in ROOTS or path.is_absolute() or ".." in path.parts or not path.parts or "\\" in relative:
        return False
    for component in path.parts:
        lower = component.lower()
        if lower.startswith(".") or lower in GENERATED_DIRS or SENSITIVE_NAME.search(lower):
            return False
    if path.suffix.lower() in {".env", ".pem", ".key", ".p12", ".pfx", ".keystore", ".pyc", ".sqlite", ".db"}:
        return False
    if service == "frontend":
        return (relative in FRONTEND_FILES
                or path.parts[0] == "src" and path.suffix in SOURCE_SUFFIXES
                or path.parts[0] == "public" and path.suffix in ASSET_SUFFIXES)
    return (relative in {"Dockerfile", "requirements.txt"}
            or path.parts[0] == "app" and path.suffix == ".py"
            or service == "support" and relative in SUPPORT_FILES
            or service == "backend" and path.parts[0] == "services" and path.suffix == ".py"
            or service == "backend" and path.parts[0] == "fonts" and path.suffix == ".ttf")


def validate_settings(content, service, required_fields, blank_fields=()):
    """Require explicit safe defaults; diagnostics contain field names only."""
    try:
        tree = ast.parse(content)
    except (SyntaxError, ValueError):
        raise ReleaseError(f"Cannot inspect {service} Settings structure.") from None
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Settings"]
    if len(classes) != 1:
        raise ReleaseError(f"Expected one explicit {service} Settings class.")
    for name in (*required_fields, *blank_fields):
        fields = [node for node in classes[0].body if isinstance(node, ast.AnnAssign)
                  and isinstance(node.target, ast.Name) and node.target.id == name]
        if len(fields) != 1:
            raise ReleaseError(f"Expected one explicit {service} Settings field: {name}.")
        stores = [node for node in ast.walk(classes[0])
                  if isinstance(node, ast.Name) and node.id == name and isinstance(node.ctx, (ast.Store, ast.Del))]
        attribute_writes = [node for node in ast.walk(tree)
                            if isinstance(node, ast.Attribute) and node.attr == name
                            and isinstance(node.ctx, (ast.Store, ast.Del))]
        if len(stores) != 1 or stores[0] is not fields[0].target or attribute_writes:
            raise ReleaseError(f"{service} Settings credential field must have one unambiguous declaration: {name}.")
        value = fields[0].value
        if isinstance(value, ast.Call):
            if not isinstance(value.func, ast.Name) or value.func.id != "Field" or len(value.args) > 1:
                raise ReleaseError(f"Unsupported {service} Settings default: {name}.")
            keywords = {keyword.arg: keyword.value for keyword in value.keywords}
            if (len(keywords) != len(value.keywords) or set(keywords) - {"default", "repr", "ge", "le"}
                    or value.args and "default" in keywords):
                raise ReleaseError(f"{service} Settings must not compute a credential default: {name}.")
            value = value.args[0] if value.args else keywords.get("default")
        required = value is None or isinstance(value, ast.Constant) and value.value is Ellipsis
        blank = isinstance(value, ast.Constant) and value.value == ""
        if not required and not (name in blank_fields and blank):
            raise ReleaseError(f"Unsafe {service} Settings credential default: {name}. Review upstream.")
    return tree


def validate_backend_settings(content):
    validate_settings(content, "backend", ("database_url", "dashboard_ro_db_password"),
                      ("meta_whatsapp_webhook_verify_token",))


def validate_dashboard_settings(content):
    fields = ("dashboard_db_host", "dashboard_db_port", "dashboard_db_name",
              "dashboard_db_user", "dashboard_ro_db_password")
    tree = validate_settings(content, "dashboard", fields)
    # The Dashboard must never acquire Backend's general-purpose DATABASE_URL.
    # Ignore comments, but reject names, attributes, aliases, and env lookup keys.
    for node in ast.walk(tree):
        value = (node.id if isinstance(node, ast.Name) else node.attr if isinstance(node, ast.Attribute)
                 else node.value if isinstance(node, ast.Constant) else None)
        if isinstance(value, str) and value.lower() == "database_url":
            raise ReleaseError("Dashboard must use dedicated read-only database fields, not DATABASE_URL.")
    settings = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Settings")
    password = next(node for node in settings.body if isinstance(node, ast.AnnAssign)
                    and isinstance(node.target, ast.Name) and node.target.id == "dashboard_ro_db_password")
    if not isinstance(password.annotation, ast.Name) or password.annotation.id != "SecretStr":
        raise ReleaseError("Dashboard password must use a dedicated required SecretStr field.")
    user = next(node for node in settings.body if isinstance(node, ast.AnnAssign)
                and isinstance(node.target, ast.Name) and node.target.id == "dashboard_db_user")
    readonly_role = ast.parse("Literal['dashboard_ro']", mode="eval").body
    if ast.dump(user.annotation) != ast.dump(readonly_role):
        raise ReleaseError("Dashboard database user must be required and restricted to the existing dashboard_ro role.")
    for node in ast.walk(settings):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Field":
            if any(keyword.arg in {"alias", "validation_alias", "serialization_alias"} for keyword in node.keywords):
                raise ReleaseError("Dashboard database fields must not alias shared configuration.")
    return tree


def validate_dashboard_database(content):
    """Only the reviewed split-field read-only URL construction is accepted."""
    try:
        tree = ast.parse(content)
    except (SyntaxError, ValueError):
        raise ReleaseError("Cannot inspect dashboard database construction.") from None
    expected = ast.parse(
        "URL.create(drivername='postgresql+asyncpg', host=settings.dashboard_db_host, "
        "port=settings.dashboard_db_port, database=settings.dashboard_db_name, "
        "username=settings.dashboard_db_user, password=settings.dashboard_ro_db_password.get_secret_value())",
        mode="eval",
    ).body
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                   and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "engine"]
    stores = [node for node in ast.walk(tree) if isinstance(node, ast.Name)
              and node.id == "engine" and isinstance(node.ctx, (ast.Store, ast.Del))]
    if len(assignments) != 1 or len(stores) != 1:
        raise ReleaseError("Expected one explicit dashboard database engine.")
    call = assignments[0].value
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "create_async_engine"
            and len(call.args) == 1 and ast.dump(call.args[0]) == ast.dump(expected)
            and all(keyword.arg is not None and keyword.arg != "connect_args" for keyword in call.keywords)):
        raise ReleaseError("Dashboard engine must use only the dedicated read-only database configuration.")
    for node in ast.walk(tree):
        value = (node.id if isinstance(node, ast.Name) else node.attr if isinstance(node, ast.Attribute)
                 else node.value if isinstance(node, ast.Constant) else None)
        if isinstance(value, str) and value.lower() == "database_url":
            raise ReleaseError("Dashboard database module must not fall back to DATABASE_URL.")


def validate_service_settings(service, relative, content):
    if relative == SETTINGS_FILES.get(service):
        if service == "backend":
            validate_backend_settings(content)
        elif service == "dashboard":
            validate_dashboard_settings(content)
        else:
            validate_settings(content, service, ("database_url",))
    if service == "dashboard" and relative == "app/database.py":
        validate_dashboard_database(content)


def validate_dockerfile(service, content, selected):
    """Inspect committed instructions only; never execute a Docker build."""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise ReleaseError(f"Cannot inspect {service} Dockerfile.") from None
    found = set()
    lines = re.sub(r"\\\r?\n", " ", text).splitlines()
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        instruction, _, arguments = line.partition(" ")
        if instruction.upper() == "ADD":
            raise ReleaseError(f"Unreviewed ADD instruction in {service} Dockerfile.")
        if instruction.upper() != "COPY":
            continue
        if arguments.startswith("--from=builder "):
            if service == "frontend" and arguments == "--from=builder /app/dist /usr/share/nginx/html":
                continue
            raise ReleaseError(f"Unreviewed build-stage COPY in {service} Dockerfile.")
        try:
            parts = json.loads(arguments) if arguments.startswith("[") else shlex.split(arguments)
        except (ValueError, TypeError):
            raise ReleaseError(f"Cannot inspect COPY sources in {service} Dockerfile.") from None
        if not isinstance(parts, list) or len(parts) < 2 or not all(isinstance(part, str) for part in parts):
            raise ReleaseError(f"Cannot inspect COPY sources in {service} Dockerfile.")
        for source in parts[:-1]:
            if source not in COPY_SOURCES[service]:
                raise ReleaseError(f"Unreviewed required COPY source in {service} Dockerfile.")
            found.add(source)
            if source != "." and not (source in selected or source.endswith("/") and any(path.startswith(source) for path in selected)):
                raise ReleaseError(f"Missing required {service} COPY input: {source}")
    if found != COPY_SOURCES[service]:
        raise ReleaseError(f"Unexpected COPY source contract in {service} Dockerfile.")


def check_content(path, content):
    if CREDENTIAL_URL.search(content) or any(pattern.search(content) for pattern in SECRET_CONTENT):
        raise ReleaseError(f"Possible embedded credential in required build source: {path}. Review upstream; no context was published.")


def prepare_contexts(repo, source_sha, output):
    output = Path(output)
    if os.path.lexists(output):
        raise ReleaseError("Output must be a new path, not an existing directory or symlink.")
    listing = git(repo, "ls-tree", "-r", "-z", source_sha, "--", *ROOTS.values())
    selected = {service: set() for service in ROOTS}
    # A private staging directory prevents partially validated contexts being used.
    with tempfile.TemporaryDirectory(prefix=".scoped-release-", dir=output.parent) as temporary:
        staging = Path(temporary) / "contexts"
        staging.mkdir()
        for entry in listing.split(b"\0"):
            if not entry:
                continue
            metadata, raw_path = entry.split(b"\t", 1)
            mode, kind, oid = metadata.decode().split()
            path = raw_path.decode("utf-8")
            for service, root in ROOTS.items():
                if not path.startswith(root + "/"):
                    continue
                relative = path[len(root) + 1:]
                if not allowed(service, relative):
                    break
                if kind != "blob" or mode not in {"100644", "100755"}:
                    raise ReleaseError(f"Only regular committed files are allowed in build contexts: {path}")
                content = git(repo, "cat-file", "blob", oid)
                check_content(path, content)
                validate_service_settings(service, relative, content)
                target_name = "Dockerfile" if relative == "Dockerfile.scoped-release" else relative
                target = staging / service / target_name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                target.chmod(0o755 if mode == "100755" else 0o644)
                selected[service].add(target_name)
                break
        for service, required in REQUIRED.items():
            missing = required - selected[service]
            if missing:
                raise ReleaseError(f"Missing required {service} build source: {', '.join(sorted(missing))}")
            validate_dockerfile(service, (staging / service / "Dockerfile").read_bytes(), selected[service])
        staging.rename(output)
    return {service: len(paths) for service, paths in selected.items()}


def ensure_tags_absent(version, opener=urlopen):
    """Public preflight, not atomic immutability; do not race other publishers."""
    root = "https://hub.docker.com/v2/repositories/dclinics/events/"
    try:
        with opener(root, timeout=20) as response:
            if response.status != 200 or response.geturl() != root:
                raise ReleaseError("Cannot establish public registry repository visibility.")
            metadata = json.load(response)
    except (HTTPError, URLError, OSError, ValueError):
        raise ReleaseError("Cannot establish public registry repository visibility.") from None
    if not isinstance(metadata, dict) or metadata.get("namespace") != "dclinics" or metadata.get("name") != "events" or metadata.get("is_private") is not False:
        raise ReleaseError("Registry repository is not the expected visible public dclinics/events repository.")
    for service in ROOTS:
        tag = f"{service}-{version}"
        url = root + f"tags/{tag}/"
        try:
            try:
                response = opener(url, timeout=20)
            except HTTPError as exc:
                response = exc
            with response:
                status = response.status
                if response.geturl() != url:
                    raise ReleaseError(f"Unexpected registry response destination for {tag}.")
                if status == 200:
                    raise ReleaseError(f"Registry tag already exists; refusing overwrite: {tag}.")
                if status != 404:
                    raise ReleaseError(f"Cannot establish registry tag absence for {tag}: HTTP {status}.")
                missing = json.load(response)
                message = missing.get("message") if isinstance(missing, dict) else None
                # Reject generic proxy/CDN 404 pages, auth errors, and unknown bodies.
                expected = rf"(?:httperror 404: )?tag ['\"]?{re.escape(tag)}['\"]? not found\.?"
                if not isinstance(message, str) or not re.fullmatch(expected, message, re.IGNORECASE) or missing.get("errinfo") not in (None, {}):
                    raise ReleaseError(f"Unrecognized registry tag-not-found response for {tag}.")
        except (URLError, OSError, ValueError) as exc:
            if isinstance(exc, ReleaseError):
                raise
            raise ReleaseError(f"Cannot establish registry tag absence for {tag}: network or invalid JSON response.") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--source-only", action="store_true", help="Verify main/SHA/VERSION before executing repository tests.")
    parser.add_argument("--check-registry", action="store_true", help="Require public HTTP 404 for all seven version tags before login.")
    args = parser.parse_args()
    try:
        validate_source(args.repo, args.expected_sha, args.version, os.environ)
        if args.source_only:
            print("Reviewed main source and VERSION verified.")
            return
        if args.output is None:
            raise ReleaseError("An output directory is required to prepare contexts.")
        validate_public_config(os.environ)
        counts = prepare_contexts(args.repo, args.expected_sha, args.output)
        if args.check_registry:
            ensure_tags_absent(args.version)
    except (ReleaseError, subprocess.CalledProcessError) as exc:
        # subprocess stderr is intentionally not replayed.
        parser.exit(1, f"Release preflight failed: {exc}\n")
    print("Validated committed contexts: " + ", ".join(f"{service}={count}" for service, count in counts.items()))


if __name__ == "__main__":
    main()
