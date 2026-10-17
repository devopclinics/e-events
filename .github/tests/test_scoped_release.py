"""Offline release safety tests. Run with Python's standard-library unittest."""
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest import mock
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("scoped_release", ROOT / ".github/scripts/prepare_scoped_release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
SERVICES = ("backend", "frontend", "marketing", "dashboard", "support", "messaging", "setup")
DASHBOARD_SETTINGS = """class Settings:
    dashboard_db_host: str
    dashboard_db_port: int = Field(ge=1, le=65535)
    dashboard_db_name: str
    dashboard_db_user: Literal['dashboard_ro']
    dashboard_ro_db_password: SecretStr = Field(repr=False)
"""
DASHBOARD_DATABASE = """engine = create_async_engine(
    URL.create(drivername='postgresql+asyncpg', host=settings.dashboard_db_host,
               port=settings.dashboard_db_port, database=settings.dashboard_db_name,
               username=settings.dashboard_db_user,
               password=settings.dashboard_ro_db_password.get_secret_value()),
    echo=False, pool_pre_ping=True)
"""


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name) / "repo"
        self.repo.mkdir()
        self.output = Path(self.temporary.name) / "contexts"
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Offline release test")
        self.git("config", "user.email", "release-test@example.invalid")
        self.write("event-checkin/VERSION", "4.0.47\n")
        for service, required in release.REQUIRED.items():
            for relative in required:
                if service == "frontend" and relative == "Dockerfile":
                    relative = "Dockerfile.scoped-release"
                self.write(f"{release.ROOTS[service]}/{relative}", "fixture\n")
            dockerfile = "Dockerfile.scoped-release" if service == "frontend" else "Dockerfile"
            self.write(f"{release.ROOTS[service]}/{dockerfile}", "FROM fixture\n" + "".join(
                f"COPY {source} ./\n" for source in sorted(release.COPY_SOURCES[service])))
        self.write("event-checkin/backend/app/config.py", "class Settings:\n    database_url: str = Field(..., repr=False)\n    dashboard_ro_db_password: str = Field(..., repr=False)\n    meta_whatsapp_webhook_verify_token: str = ''\n")
        self.write("event-checkin/dashboard-service/app/config.py", DASHBOARD_SETTINGS)
        self.write("event-checkin/dashboard-service/app/database.py", DASHBOARD_DATABASE)
        for service in ("support", "messaging", "setup"):
            self.write(f"{release.ROOTS[service]}/app/main.py", "class Settings:\n    database_url: str = Field(..., repr=False)\n")
        self.write("event-checkin/frontend/src/main.jsx", "console.log('committed source')\n")
        self.write("event-checkin/frontend/public/logo.svg", "<svg/>\n")
        self.write("event-checkin/frontend/src/docs/guide.md", "Tracked raw-import source\n")
        self.write("event-checkin/backend/fonts/Inter-Regular.ttf", b"fixture-font")
        self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE).decode().strip()

    def write(self, path, contents):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents if isinstance(contents, bytes) else contents.encode())

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "offline fixture")
        self.sha = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.sha)
        self.env = {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": self.sha}

    def prepare(self):
        return release.prepare_contexts(self.repo, self.sha, self.output)

    def test_exact_reviewed_main_and_version_pass(self):
        release.validate_source(self.repo, self.sha, "4.0.47", self.env)

    def test_wrong_dispatch_event_or_branch_fails(self):
        for key, value in (("GITHUB_EVENT_NAME", "push"), ("GITHUB_REF", "refs/heads/release"), ("GITHUB_REF", "refs/tags/v4.0.47")):
            with self.subTest(key=key, value=value), self.assertRaises(release.ReleaseError):
                release.validate_source(self.repo, self.sha, "4.0.47", self.env | {key: value})

    def test_malformed_source_or_version_fails(self):
        for sha in (self.sha[:7], "main", self.sha.upper(), "$(echo malicious)"):
            with self.subTest(sha=sha), self.assertRaises(release.ReleaseError):
                release.validate_source(self.repo, sha, "4.0.47", self.env)
        for version in ("release-a87037d", "v4.0.47", "4.0.48", "4.0.47\n", "04.0.47", "4.0.47;echo nope"):
            with self.subTest(version=version), self.assertRaises(release.ReleaseError):
                release.validate_source(self.repo, self.sha, version, self.env)

    def test_mismatched_dispatch_sha_fails(self):
        with self.assertRaises(release.ReleaseError):
            release.validate_source(self.repo, self.sha, "4.0.47", self.env | {"GITHUB_SHA": "0" * 40})

    def test_main_moving_after_dispatch_fails(self):
        previous = self.sha
        self.write("unrelated.txt", "new main\n")
        self.commit()
        self.git("checkout", "-q", previous)
        with self.assertRaises(release.ReleaseError):
            release.validate_source(self.repo, previous, "4.0.47", self.env | {"GITHUB_SHA": previous})

    def test_mismatched_checkout_fails(self):
        previous = self.sha
        self.write("unrelated.txt", "new commit\n")
        self.commit()
        self.git("update-ref", "refs/remotes/origin/main", previous)
        with self.assertRaises(release.ReleaseError):
            release.validate_source(self.repo, previous, "4.0.47", self.env | {"GITHUB_SHA": previous})

    def test_only_committed_allowed_files_are_exported(self):
        # Both ignored and ordinary untracked files are invisible to Git-tree export.
        self.write(".gitignore", "local.js\n")
        self.write("event-checkin/frontend/src/untracked.js", "untracked")
        self.write("event-checkin/frontend/src/local.js", "ignored")
        self.write("event-checkin/frontend/src/main.jsx", "dirty worktree replacement")
        self.write("event-checkin/meta token", "never read this sentinel")
        counts = self.prepare()
        self.assertEqual(set(counts), set(SERVICES))
        self.assertEqual((self.output / "frontend/src/main.jsx").read_text(), "console.log('committed source')\n")
        self.assertTrue((self.output / "frontend/public/logo.svg").is_file())
        self.assertTrue((self.output / "frontend/src/docs/guide.md").is_file())
        self.assertTrue((self.output / "backend/fonts/Inter-Regular.ttf").is_file())
        self.assertTrue((self.output / "frontend/Dockerfile").is_file())
        for relative in release.SUPPORT_FILES:
            self.assertTrue((self.output / "support" / relative).is_file(), relative)
        self.assertFalse((self.output / "frontend/Dockerfile.scoped-release").exists())
        exported = [str(path.relative_to(self.output)) for path in self.output.rglob("*")]
        self.assertFalse(any("untracked" in path or "local.js" in path or "meta token" in path for path in exported))

    def test_tracked_secret_files_and_artifacts_are_not_read_or_copied(self):
        excluded = [
            "frontend/.env", "frontend/.env.production", "frontend/.npmrc",
            "frontend/public/.env.local", "frontend/src/credentials.json",
            "frontend/public/service-account.json", "frontend/public/private-key.js",
            "frontend/public/access_token.json", "frontend/src/node_modules/package/index.js",
            "frontend/public/dist/generated.js", "frontend/public/client.pem",
            "frontend/public/config.env", "frontend/public/key.p12",
            "frontend/e2e/recording.js", "frontend/dist/bundle.js",
            "frontend/src/.cache/generated.js", "frontend/src/.aws/credentials",
            "backend/app/secrets.py", "backend/app/__pycache__/compiled.py",
            "backend/tests/fixture.py", "backend/requirements-dev.txt",
            "marketing-service/app/passwords.py",
            "dashboard-service/app/nested/.env", "dashboard-service/app/credentials.py",
            "support-service/app/config.env", "support-service/scripts/.npmrc",
            "support-service/scripts/nested/secret.py", "support-service/evaluation/access_token.jsonl",
            "messaging-service/app/private_key.py", "setup-service/app/.git/config",
            "support-service/docs/OPERATIONS_RUNBOOK.md", "setup-service/tests/fixture.py",
        ]
        for path in excluded:
            # A detectable key makes this test fail if an excluded blob is read/scanned.
            self.write("event-checkin/" + path, "-----BEGIN PRIVATE KEY-----\nsentinel")
        self.write("event-checkin/meta token", "-----BEGIN PRIVATE KEY-----\nnever scan")
        self.commit()
        self.prepare()
        for path in excluded:
            folder, relative = path.split("/", 1)
            service = folder.removesuffix("-service")
            self.assertFalse((self.output / service / relative).exists(), path)

    def test_selected_symlink_fails_without_reading_target(self):
        target = Path(self.temporary.name) / "outside-secret.js"
        target.write_text("never copy this")
        os.symlink(target, self.repo / "event-checkin/frontend/public/escape.js")
        self.commit()
        with self.assertRaisesRegex(release.ReleaseError, "regular committed files"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_existing_output_and_dangling_output_symlink_fail(self):
        self.output.mkdir()
        with self.assertRaises(release.ReleaseError):
            self.prepare()
        self.output.rmdir()
        os.symlink(Path(self.temporary.name) / "absent", self.output)
        with self.assertRaises(release.ReleaseError):
            self.prepare()
        self.assertTrue(self.output.is_symlink())

    def test_embedded_credentials_fail_without_echoing_values(self):
        for payload in (
            'DATABASE_URL = "postgresql+asyncpg://demo:synthetic-secret@db/service"',
            'KEY = "-----BEGIN RSA PRIVATE KEY-----"',
            '{"type": "service_account", "private_key": "synthetic-secret"}',
        ):
            self.write("event-checkin/backend/app/config.py", payload)
            self.commit()
            with self.subTest(payload_type=payload.split("=")[0]), self.assertRaises(release.ReleaseError) as error:
                self.prepare()
            self.assertNotIn("synthetic-secret", str(error.exception))
            self.assertIn("backend/app/config.py", str(error.exception))
            self.assertFalse(self.output.exists())

    def test_missing_required_source_fails_atomically(self):
        self.git("rm", "-q", "event-checkin/frontend/package-lock.json")
        self.git("commit", "-qm", "remove required input")
        self.sha = self.git("rev-parse", "HEAD")
        with self.assertRaisesRegex(release.ReleaseError, "Missing required frontend"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_each_new_component_required_source_is_enforced_atomically(self):
        for service in ("dashboard", "support", "messaging", "setup"):
            for relative in release.REQUIRED[service]:
                path = f"{release.ROOTS[service]}/{relative}"
                original = (self.repo / path).read_bytes()
                self.git("rm", "-q", path)
                self.commit()
                with self.subTest(service=service, relative=relative), self.assertRaises(release.ReleaseError):
                    self.prepare()
                self.assertFalse(self.output.exists())
                self.write(path, original)
                self.commit()

    def test_new_component_database_defaults_fail_atomically(self):
        for service in ("support", "messaging", "setup"):
            path = f"{release.ROOTS[service]}/app/main.py"
            original = (self.repo / path).read_bytes()
            self.write(path, "class Settings:\n    database_url: str = 'synthetic-secret'\n")
            self.commit()
            with self.subTest(service=service), self.assertRaises(release.ReleaseError) as error:
                self.prepare()
            self.assertNotIn("synthetic-secret", str(error.exception))
            self.assertFalse(self.output.exists())
            self.write(path, original)
            self.commit()

    def test_each_new_context_rejects_selected_symlinks(self):
        for service in ("dashboard", "support", "messaging", "setup"):
            path = self.repo / release.ROOTS[service] / "app/main.py"
            original = path.read_bytes()
            path.unlink()
            os.symlink("../../../../secret-outside-context.py", path)
            self.commit()
            with self.subTest(service=service), self.assertRaisesRegex(release.ReleaseError, "regular committed files"):
                self.prepare()
            self.assertFalse(self.output.exists())
            path.unlink()
            path.write_bytes(original)
            self.commit()

    def test_nonregular_git_tree_entries_fail_before_blob_read(self):
        for service in SERVICES:
            for metadata in ("120000 blob", "160000 commit", "100664 blob", "040000 tree"):
                listing = f"{metadata} {'0' * 40}\t{release.ROOTS[service]}/app/unsafe.py\0".encode()
                # Use frontend's source allowlist instead of app/.
                if service == "frontend":
                    listing = listing.replace(b"app/unsafe.py", b"src/unsafe.js")
                with self.subTest(service=service, metadata=metadata), mock.patch.object(release, "git", return_value=listing) as git:
                    with self.assertRaisesRegex(release.ReleaseError, "regular committed files"):
                        self.prepare()
                    self.assertEqual(git.call_count, 1)
                self.assertFalse(self.output.exists())

    def test_unreviewed_docker_copy_input_fails_atomically(self):
        for service in SERVICES:
            relative = "Dockerfile.scoped-release" if service == "frontend" else "Dockerfile"
            path = self.repo / release.ROOTS[service] / relative
            original = path.read_text()
            path.write_text(original + "COPY unreviewed-file.bin ./\n")
            self.commit()
            with self.subTest(service=service), self.assertRaisesRegex(release.ReleaseError, "Unreviewed required COPY"):
                self.prepare()
            self.assertFalse(self.output.exists())
            path.write_text(original)
            self.commit()

    def test_embedded_repository_credentials_in_new_contexts_fail(self):
        for service in ("dashboard", "support", "messaging", "setup"):
            path = self.repo / release.ROOTS[service] / "requirements.txt"
            original = path.read_text()
            for url in ("https://demo:synthetic-secret@github.com/owner/repo.git",
                        "git+https://synthetic-secret@github.com/owner/repo.git"):
                path.write_text("dependency @ " + url + "\n")
                self.commit()
                with self.subTest(service=service), self.assertRaises(release.ReleaseError) as error:
                    self.prepare()
                self.assertNotIn("synthetic-secret", str(error.exception))
                self.assertFalse(self.output.exists())
            path.write_text(original)
            self.commit()


class ConfigurationTests(unittest.TestCase):
    def test_public_config_requires_all_six_values_without_echoing_them(self):
        config = {name: "synthetic-public-value" for name in release.FIREBASE_KEYS}
        release.validate_public_config(config)
        for name in release.FIREBASE_KEYS:
            for invalid in (None, "", " ", "value\nINJECTED=1", "value\x00"):
                with self.subTest(name=name, invalid=invalid), self.assertRaises(release.ReleaseError) as error:
                    release.validate_public_config(config | {name: invalid})
                self.assertIn(name, str(error.exception))
                self.assertNotIn("synthetic-public-value", str(error.exception))

    def test_sensitive_names_and_path_traversal_fail_allowlist(self):
        for path in ("/src/app.js", "src/../../escape.js", "public/.ENV", "src/secret.json", "src/credentials.backup.json", "src/token-store.js", "public/service_account.json", "public/id_rsa", "public/key.pem", "public/.npmrc", "public/node_modules/x.js"):
            with self.subTest(path=path):
                self.assertFalse(release.allowed("frontend", path))

    def test_every_component_excludes_nested_sensitive_and_generated_paths(self):
        for service in SERVICES:
            for path in ("app/.env", "app/nested/.env.production", "app/secret.py", "app/credentials.py",
                         "app/nested/token-store.py", "app/private_key.py", "app/__pycache__/code.py",
                         "app/node_modules/code.py", "src/.npmrc", "src/.git/config", "scripts/.env",
                         "evaluation/credentials.jsonl", "app/../../outside.py", "app\\outside.py"):
                with self.subTest(service=service, path=path):
                    self.assertFalse(release.allowed(service, path))
        self.assertFalse(release.allowed("unreviewed-service", "app/main.py"))

    def test_support_assets_are_explicit_not_extension_wide(self):
        for path in release.SUPPORT_FILES:
            self.assertTrue(release.allowed("support", path), path)
            for service in ("dashboard", "messaging", "setup", "marketing"):
                self.assertFalse(release.allowed(service, path), (service, path))
        for path in ("app/unknown.md", "scripts/unknown.py", "evaluation/unknown.jsonl", "docs/guide.md"):
            self.assertFalse(release.allowed("support", path), path)

    def test_backend_settings_require_credentials_and_blank_legacy_verify_token(self):
        safe = "class Settings:\n    database_url: str = Field(..., repr=False)\n    dashboard_ro_db_password: str = Field(default=..., repr=False)\n    meta_whatsapp_webhook_verify_token: str = ''\n"
        release.validate_backend_settings(safe)
        release.validate_backend_settings(safe.replace("Field(..., repr=False)", "..."))
        for name in ("database_url", "dashboard_ro_db_password", "meta_whatsapp_webhook_verify_token"):
            rows = [f"    {field}: str = 'synthetic-secret'" if field == name else row for field, row in zip(("database_url", "dashboard_ro_db_password", "meta_whatsapp_webhook_verify_token"), safe.splitlines()[1:])]
            with self.subTest(name=name), self.assertRaises(release.ReleaseError) as error:
                release.validate_backend_settings("class Settings:\n" + "\n".join(rows))
            self.assertNotIn("synthetic-secret", str(error.exception))
        for bad in (safe.replace("Field(..., repr=False)", "''"), safe.replace("Field(..., repr=False)", "Field(default_factory=load_credentials)"), safe.replace("Field(..., repr=False)", "OtherField(...)"), "class OtherSettings: pass"):
            with self.assertRaises(release.ReleaseError):
                release.validate_backend_settings(bad)

    def test_settings_reassignment_duplicates_and_conditional_defaults_fail(self):
        safe = "class Settings:\n    database_url: str = Field(...)\n    dashboard_ro_db_password: str = Field(...)\n    meta_whatsapp_webhook_verify_token: str = ''\n"
        for extra in (
            "    dashboard_ro_db_password = 'synthetic-secret'\n",
            "    dashboard_ro_db_password += 'synthetic-secret'\n",
            "    dashboard_ro_db_password: str = 'synthetic-secret'\n",
            "    if True:\n        dashboard_ro_db_password = 'synthetic-secret'\n",
            "    del dashboard_ro_db_password\n",
            "Settings.dashboard_ro_db_password = 'synthetic-secret'\n",
        ):
            with self.subTest(extra=extra), self.assertRaises(release.ReleaseError):
                release.validate_backend_settings(safe + extra)

    def test_three_services_require_explicit_database_configuration(self):
        for service in ("support", "messaging", "setup"):
            for default in ("Field(..., repr=False)", "...", "Field(default=...)", None):
                declaration = "database_url: str" + (" = " + default if default is not None else "")
                release.validate_service_settings(service, "app/main.py", "class Settings:\n    " + declaration)
            for default in ("''", "None", "'synthetic-secret'", "load_credentials()", "Field(default_factory=load_credentials)",
                            "Field(..., **dynamic)", "Field(default='synthetic-secret', default=...)",
                            "Field(..., default='synthetic-secret')", "Field(..., alias='DATABASE_URL')"):
                with self.subTest(service=service, default=default), self.assertRaises(release.ReleaseError) as error:
                    release.validate_service_settings(service, "app/main.py", "class Settings:\n    database_url: str = " + default)
                self.assertNotIn("synthetic-secret", str(error.exception))
            for extra in ("    database_url = 'synthetic-secret'\n", "    del database_url\n",
                          "Settings.database_url = 'synthetic-secret'\n"):
                with self.assertRaises(release.ReleaseError):
                    release.validate_service_settings(service, "app/main.py", "class Settings:\n    database_url: str = Field(...)\n" + extra)

    def test_dashboard_requires_dedicated_secret_and_all_split_fields(self):
        release.validate_dashboard_settings(DASHBOARD_SETTINGS)
        for line in DASHBOARD_SETTINGS.splitlines()[1:]:
            field = line.strip().split(":", 1)[0]
            for replacement in ("", f"    {field}: str = 'synthetic-secret'", f"    {field}: str = Field(default_factory=load_config)"):
                with self.subTest(field=field), self.assertRaises(release.ReleaseError) as error:
                    release.validate_dashboard_settings(DASHBOARD_SETTINGS.replace(line, replacement))
                self.assertNotIn("synthetic-secret", str(error.exception))
        with self.assertRaises(release.ReleaseError):
            release.validate_dashboard_settings(DASHBOARD_SETTINGS.replace("SecretStr", "str"))

    def test_dashboard_requires_existing_readonly_role_without_a_default(self):
        for declaration in ("str", "Literal['backend']", "Literal['dashboard_ro', 'backend']",
                            "Literal['dashboard_ro'] = 'dashboard_ro'", "Literal['dashboard_ro'] = Field('dashboard_ro')"):
            with self.subTest(declaration=declaration), self.assertRaises(release.ReleaseError):
                release.validate_dashboard_settings(DASHBOARD_SETTINGS.replace("Literal['dashboard_ro']", declaration))

    def test_dashboard_disallows_shared_database_url_fallback_and_aliases(self):
        for extra in ("    database_url: str = Field(...)\n", "    fallback = os.getenv('DATABASE_URL')\n",
                      "    fallback = settings.database_url\n", "    fallback = DATABASE_URL\n"):
            with self.subTest(extra=extra), self.assertRaises(release.ReleaseError):
                release.validate_dashboard_settings(DASHBOARD_SETTINGS + extra)
        for keyword in ("alias", "validation_alias", "serialization_alias"):
            with self.subTest(keyword=keyword), self.assertRaises(release.ReleaseError):
                release.validate_dashboard_settings(DASHBOARD_SETTINGS.replace("Field(repr=False)", f"Field(repr=False, {keyword}='DATABASE_URL')"))

    def test_dashboard_database_uses_exact_split_fields_without_reassignment(self):
        release.validate_dashboard_database(DASHBOARD_DATABASE)
        for original, replacement in (
            ("settings.dashboard_db_host", "os.getenv('DATABASE_URL')"),
            ("settings.dashboard_db_user", "settings.database_url"),
            ("settings.dashboard_ro_db_password.get_secret_value()", "'synthetic-secret'"),
            ("settings.dashboard_ro_db_password.get_secret_value()", "settings.dashboard_ro_db_password.get_secret_value() or load_credentials()"),
            ("echo=False", "connect_args={'password': 'synthetic-secret'}"),
            ("echo=False", "**dynamic"),
        ):
            with self.subTest(original=original), self.assertRaises(release.ReleaseError) as error:
                release.validate_dashboard_database(DASHBOARD_DATABASE.replace(original, replacement))
            self.assertNotIn("synthetic-secret", str(error.exception))
        for extra in ("engine = other_engine\n", "if enabled:\n    engine = other_engine\n", "fallback = os.getenv('DATABASE_URL')\n"):
            with self.assertRaises(release.ReleaseError):
                release.validate_dashboard_database(DASHBOARD_DATABASE + extra)

    def test_copy_contract_rejects_unknown_unsafe_remote_or_missing_sources(self):
        for service in SERVICES:
            valid = "".join(f"COPY {source} ./\n" for source in sorted(release.COPY_SOURCES[service]))
            selected = set(release.REQUIRED[service]) | {"fonts/font.ttf", "services/__init__.py"}
            release.validate_dockerfile(service, valid.encode(), selected)
            for addition in ("COPY .env .", "COPY ../outside .", "COPY https://example.invalid/code .", "ADD app/ app/",
                             "COPY --from=unreviewed /x /y", "COPY [\"credentials.json\", \".\"]", "COPY *.py app/", "COPY ${DYNAMIC} ."):
                with self.subTest(service=service, addition=addition), self.assertRaises(release.ReleaseError):
                    release.validate_dockerfile(service, (valid + addition).encode(), selected)
            with self.assertRaises(release.ReleaseError):
                release.validate_dockerfile(service, valid.encode(), set())
            with self.assertRaises(release.ReleaseError):
                release.validate_dockerfile(service, b"FROM fixture\n", selected)

    def test_json_copy_and_reviewed_frontend_stage_are_supported(self):
        content = b'COPY ["requirements.txt", "."]\nCOPY ["app/", "app/"]\n'
        release.validate_dockerfile("messaging", content, release.REQUIRED["messaging"])
        content = b'COPY package.json package-lock.json ./\nCOPY . .\nCOPY nginx.conf /etc/nginx/conf.d/default.conf\nCOPY --from=builder /app/dist /usr/share/nginx/html\n'
        release.validate_dockerfile("frontend", content, release.REQUIRED["frontend"])

    def registry_response(self, url, payload, status=200):
        response = io.BytesIO(payload if isinstance(payload, bytes) else json.dumps(payload).encode())
        response.status = status
        response.geturl = lambda: url
        return response

    def repository_response(self, url):
        return self.registry_response(url, {"namespace": "dclinics", "name": "events", "is_private": False})

    def test_registry_requires_public_repository_then_explicit_tag_404s(self):
        calls = []
        def absent(url, timeout):
            calls.append(url)
            self.assertEqual(timeout, 20)
            if "/tags/" not in url:
                return self.repository_response(url)
            tag = url.rstrip("/").rsplit("/", 1)[1]
            body = io.BytesIO(json.dumps({"message": f"httperror 404: tag '{tag}' not found", "errinfo": {}}).encode())
            raise HTTPError(url, 404, "absent", {}, body)
        release.ensure_tags_absent("4.0.47", opener=absent)
        root = "https://hub.docker.com/v2/repositories/dclinics/events/"
        self.assertEqual(calls, [root] + [root + f"tags/{service}-4.0.47/" for service in SERVICES])

    def test_hidden_wrong_private_and_malformed_repository_metadata_block(self):
        for metadata in (b"<html>404</html>", {}, [], {"namespace": "wrong", "name": "events", "is_private": False}, {"namespace": "dclinics", "name": "wrong", "is_private": False}, {"namespace": "dclinics", "name": "events", "is_private": True}, {"namespace": "dclinics", "name": "events", "is_private": "false"}):
            with self.subTest(metadata=metadata), self.assertRaises(release.ReleaseError):
                release.ensure_tags_absent("4.0.47", opener=lambda url, **kwargs: self.registry_response(url, metadata))
        with self.assertRaises(release.ReleaseError):
            release.ensure_tags_absent("4.0.47", opener=lambda url, **kwargs: self.registry_response(url, {}, 404))
        with self.assertRaises(release.ReleaseError):
            release.ensure_tags_absent("4.0.47", opener=lambda url, **kwargs: self.repository_response("https://untrusted.invalid/"))

    def test_existing_tags_and_network_auth_server_failures_block(self):
        failures = [200, 401, 403, 429, 500, URLError("offline"), TimeoutError()]
        for failure in failures:
            def fail(url, **kwargs):
                if "/tags/" not in url:
                    return self.repository_response(url)
                if isinstance(failure, Exception):
                    raise failure
                return self.registry_response(url, {}, failure)
            with self.subTest(failure=failure), self.assertRaises(release.ReleaseError):
                release.ensure_tags_absent("4.0.47", opener=fail)

    def test_each_component_tag_must_be_absent_and_guard_stops_at_first_failure(self):
        for failing_service in SERVICES:
            for status in (200, 401, 403, 429, 500):
                seen = []
                def check(url, **kwargs):
                    if "/tags/" not in url:
                        return self.repository_response(url)
                    service = url.rsplit("/", 2)[-2].removesuffix("-4.0.47")
                    seen.append(service)
                    if service == failing_service:
                        return self.registry_response(url, {}, status)
                    return self.registry_response(url, {"message": f"tag '{service}-4.0.47' not found"}, 404)
                with self.subTest(service=failing_service, status=status), self.assertRaises(release.ReleaseError):
                    release.ensure_tags_absent("4.0.47", opener=check)
                self.assertEqual(seen, list(SERVICES[:SERVICES.index(failing_service) + 1]))

    def test_tag_redirects_and_malformed_responses_block(self):
        for target in ("https://untrusted.invalid/", "https://hub.docker.com/v2/repositories/dclinics/events/tags/other/"):
            def redirected(url, **kwargs):
                return self.repository_response(url) if "/tags/" not in url else self.registry_response(target, {"message": "tag 'backend-4.0.47' not found"}, 404)
            with self.subTest(target=target), self.assertRaises(release.ReleaseError):
                release.ensure_tags_absent("4.0.47", opener=redirected)

    def test_generic_permission_malformed_and_wrong_tag_404_bodies_block(self):
        for body in (b"", b"<html>Not Found</html>", {}, [], {"message": "permission denied"}, {"message": "tag 'other' not found"}, {"message": "tag 'backend-4.0.47' not found", "errinfo": {"code": "DENIED"}}):
            def fail(url, **kwargs):
                return self.repository_response(url) if "/tags/" not in url else self.registry_response(url, body, 404)
            with self.subTest(body=body), self.assertRaises(release.ReleaseError):
                release.ensure_tags_absent("4.0.47", opener=fail)


class WorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / ".github/workflows/release-engagement.yml").read_text()
        cls.dockerfile = (ROOT / "event-checkin/frontend/Dockerfile.scoped-release").read_text()

    def test_manual_main_source_and_minimal_permissions(self):
        trigger = self.workflow.split("on:\n", 1)[1].split("permissions:", 1)[0]
        self.assertIn("  workflow_dispatch:\n", trigger)
        self.assertNotIn("  push:", trigger)
        self.assertNotIn("pull_request", trigger)
        self.assertIn("permissions:\n  contents: read\n", self.workflow)
        self.assertIn("ref: main\n", self.workflow)
        self.assertIn("persist-credentials: false", self.workflow)
        self.assertIn('--expected-sha "$EXPECTED_SHA"', self.workflow)
        self.assertIn('--version "$RELEASE_VERSION"', self.workflow)
        self.assertIn("--check-registry", self.workflow)
        self.assertLess(self.workflow.index("--source-only"), self.workflow.index("Test release guards offline"))
        self.assertLess(self.workflow.index("--check-registry"), self.workflow.index("uses: docker/login-action"))
        self.assertLess(self.workflow.index("--check-registry"), self.workflow.index("uses: docker/build-push-action"))
        self.assertEqual(set(re.findall(r"secrets\.([A-Z_]+)", self.workflow)), {"DOCKER_USERNAME", "DOCKER_PASSWORD"})

    def test_only_seven_sanitized_versioned_images_and_no_deployment(self):
        contexts = re.findall(r"^          context: (.+)$", self.workflow, re.M)
        tags = re.findall(r"^          tags: (.+)$", self.workflow, re.M)
        self.assertEqual(contexts, ["${{ runner.temp }}/festio-engagement-release/" + service for service in SERVICES])
        self.assertEqual(tags, ["${{ env.REGISTRY }}:" + service + "-${{ env.RELEASE_VERSION }}" for service in SERVICES])
        self.assertEqual(self.workflow.count("uses: docker/build-push-action@"), 7)
        self.assertEqual(self.workflow.count("platforms: linux/amd64,linux/arm64"), 7)
        self.assertNotRegex(self.workflow, r"(?m)^\s*(?:run: )?(?:git tag|git push|ssh |scp |docker compose|kubectl )")
        self.assertNotIn("contents: write", self.workflow)
        self.assertNotIn("packages: write", self.workflow)
        self.assertNotIn(":latest", self.workflow)
        self.assertNotRegex(self.workflow, r"workflow_run:|repository_dispatch:|gh workflow run|workflow-dispatch")
        self.assertIn("REGISTRY: dclinics/events", self.workflow)

    def test_public_config_passed_without_dotenv_and_sales_gates_hard_false(self):
        for name in release.FIREBASE_KEYS:
            self.assertIn(name + ": ${{ vars." + name + " }}", self.workflow)
            self.assertIn(name + "=${{ vars." + name + " }}", self.workflow)
            self.assertIn("ARG " + name, self.dockerfile)
        for name in ("VITE_SALES_CHAT_ENABLED", "VITE_SALES_CHAT_INBOX_VALIDATED"):
            self.assertIn(name + ': "false"', self.workflow)
            self.assertIn(name + "=false", self.dockerfile)
            self.assertNotIn("ARG " + name, self.dockerfile)
        instructions = "\n".join(line for line in self.dockerfile.splitlines() if not line.startswith("#"))
        self.assertNotIn(".npmrc", instructions)
        self.assertNotRegex(instructions, r"COPY.*\.env")
        self.assertIn("npm ci --ignore-scripts --legacy-peer-deps --userconfig=/dev/null", self.dockerfile)
        self.assertNotIn("npm install", self.dockerfile)
        self.assertIn("Missing or invalid public Firebase config", self.dockerfile)
        self.assertIn("RUN npm run build", self.dockerfile)

    def test_normal_ci_runs_offline_guards_without_registry_or_credentials(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        job = ci.split("  scoped-release-guards:\n", 1)[1]
        self.assertIn("contents: read", job)
        self.assertIn("persist-credentials: false", job)
        self.assertIn("python3 -m unittest discover -s .github/tests -p 'test_scoped_release.py' -v", job)
        self.assertNotIn("secrets.", job)
        self.assertNotIn("--check-registry", job)
        self.assertNotIn("docker/login", job)

    def test_publication_summary_reports_partial_failure_without_retry(self):
        self.assertIn("if: always()", self.workflow)
        self.assertIn("A failed push may leave a partial or uncertain registry result.", self.workflow)
        self.assertIn("Inspect all seven tags before retrying", self.workflow)
        self.assertIn('for service in ("backend", "frontend", "marketing", "dashboard", "support", "messaging", "setup"):', self.workflow)
        for service in SERVICES:
            self.assertIn("id: " + service + "_image", self.workflow)
            self.assertIn("${{ steps." + service + "_image.outcome }}", self.workflow)
            self.assertIn("${{ steps." + service + "_image.outputs.digest }}", self.workflow)

    def test_exact_provenance_labels_and_marketing_image_gates(self):
        self.assertEqual(self.workflow.count("org.opencontainers.image.source=https://github.com/devopclinics/e-events"), 7)
        self.assertEqual(self.workflow.count("org.opencontainers.image.revision=${{ env.EXPECTED_SHA }}"), 7)
        self.assertEqual(self.workflow.count("org.opencontainers.image.version=${{ env.RELEASE_VERSION }}"), 7)
        for service in SERVICES:
            self.assertEqual(self.workflow.count("io.festio.component=" + service), 1)
        for label in ("io.festio.sales-chat-enabled=false", "io.festio.sales-chat-inbox-validated=false", "io.festio.firebase-public-config-source=github-actions-repository-variables"):
            self.assertEqual(self.workflow.count(label), 1)
        self.assertNotIn("festio.validation-only=true", self.workflow)
        marketing = (ROOT / "event-checkin/marketing-service/Dockerfile").read_text()
        self.assertIn("ENV MARKETING_OUTBOUND_ENABLED=false", marketing)
        self.assertIn("MARKETING_SCHEDULER_ENABLED=false", marketing)


class EntrypointTests(unittest.TestCase):
    def run_preflight(self, *, failed_stage=None, source_only=False):
        stages = ("validate_source", "validate_public_config", "prepare_contexts", "ensure_tags_absent")
        calls = []
        def stage(name):
            def execute(*args, **kwargs):
                calls.append(name)
                if name == failed_stage:
                    raise release.ReleaseError("synthetic validation failure")
                return {service: 1 for service in SERVICES} if name == "prepare_contexts" else None
            return execute
        arguments = ["prepare_scoped_release.py", "--expected-sha", "0" * 40,
                     "--version", "4.0.47", "--output", "/synthetic/not-created", "--check-registry"]
        if source_only:
            arguments.append("--source-only")
        with mock.patch("sys.argv", arguments), mock.patch("sys.stdout", new_callable=io.StringIO), mock.patch("sys.stderr", new_callable=io.StringIO):
            with mock.patch.multiple(release, **{name: stage(name) for name in stages}):
                if failed_stage:
                    with self.assertRaises(SystemExit) as error:
                        release.main()
                    self.assertEqual(error.exception.code, 1)
                else:
                    release.main()
        return calls

    def test_source_public_config_and_all_contexts_validated_before_registry(self):
        self.assertEqual(self.run_preflight(), ["validate_source", "validate_public_config", "prepare_contexts", "ensure_tags_absent"])

    def test_any_preflight_failure_stops_without_later_actions(self):
        stages = ["validate_source", "validate_public_config", "prepare_contexts", "ensure_tags_absent"]
        for index, name in enumerate(stages):
            with self.subTest(stage=name):
                self.assertEqual(self.run_preflight(failed_stage=name), stages[:index + 1])

    def test_source_only_never_reads_public_config_contexts_or_registry(self):
        self.assertEqual(self.run_preflight(source_only=True), ["validate_source"])


class CurrentSourceTests(unittest.TestCase):
    def test_reviewed_component_dockerfiles_and_settings_pass_offline_guards(self):
        # These are only known required source paths, never dotenv/npmrc files.
        # The real preflight separately exports *committed* blobs, not these files.
        for service in SERVICES:
            selected = set(release.REQUIRED[service]) | {"fonts/Inter-Regular.ttf", "services/__init__.py"}
            filename = "Dockerfile.scoped-release" if service == "frontend" else "Dockerfile"
            with self.subTest(service=service):
                release.validate_dockerfile(service, (ROOT / release.ROOTS[service] / filename).read_bytes(), selected)
                if service in release.SETTINGS_FILES:
                    relative = release.SETTINGS_FILES[service]
                    content = (ROOT / release.ROOTS[service] / relative).read_bytes()
                    release.check_content(f"{service}/{relative}", content)
                    release.validate_service_settings(service, relative, content)
                if service == "dashboard":
                    release.validate_dashboard_database((ROOT / release.ROOTS[service] / "app/database.py").read_bytes())


if __name__ == "__main__":
    unittest.main()
