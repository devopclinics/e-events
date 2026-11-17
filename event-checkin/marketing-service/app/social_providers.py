"""Official provider adapters. Never log provider responses or credential URLs."""

import os
from pathlib import Path
from urllib.parse import urlsplit



class DeliveryError(Exception):
    def __init__(self, message, *, uncertain=False, retryable=False, rejected=False):
        super().__init__(message)
        self.uncertain, self.retryable, self.rejected = uncertain, retryable, rejected


def checked(response, *, mutating=False):
    if response.status_code >= 400:
        # A server failure after a write may still have created a post.
        raise DeliveryError(
            f"Provider returned HTTP {response.status_code}.",
            uncertain=mutating and response.status_code >= 500,
            retryable=response.status_code == 429
            or (not mutating and response.status_code >= 500),
            rejected=mutating and 400 <= response.status_code < 500,
        )
    return response.json() if response.content else {}


def identifier(value):
    value = str(value or "")
    if not value or not all(c.isalnum() or c in "_-" for c in value):
        raise DeliveryError(
            "Provider returned an invalid post identifier.", uncertain=True
        )
    return value


def graph_url(identifier_value, suffix=""):
    ident = identifier(identifier_value)
    version = os.getenv("MARKETING_META_GRAPH_VERSION", "v23.0")
    if not version.startswith("v") or not version[1:].replace(".", "").isdigit():
        raise DeliveryError("Invalid Meta API version configuration.")
    return f"https://graph.facebook.com/{version}/{ident}{suffix}"


async def youtube_token(client, credentials):
    if not all(
        credentials.get(k)
        for k in ("client_id", "client_secret", "refresh_token", "channel_id")
    ):
        raise DeliveryError("Connect and verify a YouTube channel first.")
    response = await client.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
            "refresh_token": credentials["refresh_token"],
            "grant_type": "refresh_token",
        },
    )
    result = checked(response)
    if not result.get("access_token"):
        raise DeliveryError("YouTube authorization needs to be renewed.")
    return result["access_token"]


async def publish(client, platform, payload, credentials, asset, progress, checkpoint):
    """Return a provider id and permalink; persist upload progress before publishing.

    A checkpoint also records entry into a non-idempotent provider operation. Any
    interruption then requires reconciliation instead of blind automatic retry.
    """
    if platform not in {"facebook", "instagram", "youtube"}:
        raise DeliveryError("This platform requires manual publishing.")
    if platform == "youtube":
        token = await youtube_token(client, credentials)
        auth = {"Authorization": f"Bearer {token}"}
        channels = checked(
            await client.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "id", "mine": "true"},
                headers=auth,
            )
        )
        if credentials["channel_id"] not in {
            c["id"] for c in channels.get("items", [])
        }:
            raise DeliveryError(
                "YouTube authorization does not match the configured channel."
            )
        if progress.get("provider_id"):
            video_id = identifier(progress["provider_id"])
        else:
            checkpoint({**progress, "phase": "upload_start"})
            response = await client.post(
                "https://www.googleapis.com/upload/youtube/v3/videos",
                params={
                    "uploadType": "resumable",
                    "part": "snippet,status",
                    "notifySubscribers": "false",
                },
                headers={
                    **auth,
                    "X-Upload-Content-Length": str(asset["size"]),
                    "X-Upload-Content-Type": asset["mime"],
                },
                json={
                    "snippet": {
                        "title": payload["title"],
                        "description": payload["caption"],
                        "categoryId": "22",
                    },
                    "status": {
                        "privacyStatus": payload["visibility"],
                        "selfDeclaredMadeForKids": payload["made_for_kids"],
                        "containsSyntheticMedia": payload["synthetic_media"],
                    },
                },
            )
            checked(response, mutating=True)
            upload_url = response.headers.get("Location", "")
            parsed = urlsplit(upload_url)
            if (
                parsed.scheme != "https"
                or parsed.hostname != "www.googleapis.com"
                or parsed.port not in (None, 443)
            ):
                raise DeliveryError(
                    "YouTube returned an invalid upload location.", uncertain=True
                )
            checkpoint({"phase": "uploading", "upload_url": upload_url})

            async def chunks():
                with Path(asset["path"]).open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        yield chunk

            result = checked(
                await client.put(
                    upload_url,
                    headers={
                        **auth,
                        "Content-Length": str(asset["size"]),
                        "Content-Type": asset["mime"],
                    },
                    content=chunks(),
                ),
                mutating=True,
            )
            video_id = identifier(result.get("id"))
            checkpoint({"phase": "accepted", "provider_id": video_id})
        status = checked(
            await client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                headers=auth,
                params={"part": "status,processingDetails", "id": video_id},
            )
        )
        items = status.get("items", [])
        if not items:
            raise DeliveryError(
                "YouTube upload is awaiting confirmation.", retryable=True
            )
        state = items[0].get("status", {})
        if state.get("uploadStatus") in {"failed", "rejected", "deleted"}:
            raise DeliveryError("YouTube could not process the uploaded video.")
        if (
            state.get("uploadStatus") != "processed"
            or state.get("privacyStatus") != payload["visibility"]
        ):
            raise DeliveryError(
                "YouTube upload is processing or visibility needs review.",
                retryable=True,
            )
        return video_id, f"https://www.youtube.com/watch?v={video_id}"

    token = credentials.get("access_token")
    account = credentials.get("page_id" if platform == "facebook" else "user_id")
    if not token or not account:
        raise DeliveryError(f"Connect a {platform.title()} account first.")
    auth = {"Authorization": f"Bearer {token}"}
    if platform == "facebook":
        if progress.get("provider_id"):
            post_id = identifier(progress["provider_id"])
        else:
            kind = payload["format"]
            suffix = {"text": "/feed", "image": "/photos", "video": "/videos"}[kind]
            body = (
                {"message": payload["caption"]}
                if kind != "video"
                else {"description": payload["caption"], "title": payload["title"]}
            )
            if kind == "text" and payload.get("link_url"):
                body["link"] = payload["link_url"]
            if kind == "image":
                body["url"] = asset["url"]
            if kind == "video":
                body["file_url"] = asset["url"]
            checkpoint({"phase": "publishing"})
            post_url = graph_url(account, suffix)
            if kind == "video":
                post_url = post_url.replace(
                    "graph.facebook.com", "graph-video.facebook.com"
                )
            result = checked(
                await client.post(post_url, headers=auth, data=body), mutating=True
            )
            post_id = identifier(result.get("post_id") or result.get("id"))
            checkpoint({"phase": "accepted", "provider_id": post_id})
        fields = (
            "id,permalink_url,status"
            if payload["format"] == "video"
            else "id,permalink_url"
        )
        result = checked(
            await client.get(
                graph_url(post_id), headers=auth, params={"fields": fields}
            )
        )
        if payload["format"] == "video":
            video_status = result.get("status", {}).get("video_status")
            if video_status == "error":
                raise DeliveryError("Facebook could not process the uploaded video.")
            if video_status != "ready":
                raise DeliveryError("Facebook video is processing.", retryable=True)
        if not result.get("id"):
            raise DeliveryError(
                "Facebook post is awaiting confirmation.", retryable=True
            )
        return post_id, result.get(
            "permalink_url"
        ) or f"https://www.facebook.com/{post_id}"

    # Instagram containers can process asynchronously; persist and poll the same one.
    if progress.get("provider_id"):
        post_id = identifier(progress["provider_id"])
    else:
        container_id = progress.get("container_id")
        if not container_id:
            body = {"caption": payload["caption"]}
            if payload["format"] == "image":
                body["image_url"] = asset["url"]
            else:
                body.update(
                    media_type="REELS", video_url=asset["url"], share_to_feed="true"
                )
            checkpoint({"phase": "container_start"})
            result = checked(
                await client.post(
                    graph_url(account, "/media"), headers=auth, data=body
                ),
                mutating=True,
            )
            container_id = identifier(result.get("id"))
            checkpoint({"phase": "processing", "container_id": container_id})
        result = checked(
            await client.get(
                graph_url(container_id), headers=auth, params={"fields": "status_code"}
            )
        )
        if result.get("status_code") in {"ERROR", "EXPIRED"}:
            raise DeliveryError("Instagram could not process this media.")
        if result.get("status_code") != "FINISHED":
            raise DeliveryError("Instagram media is processing.", retryable=True)
        checkpoint({"phase": "publishing", "container_id": container_id})
        result = checked(
            await client.post(
                graph_url(account, "/media_publish"),
                headers=auth,
                data={"creation_id": container_id},
            ),
            mutating=True,
        )
        post_id = identifier(result.get("id"))
        checkpoint(
            {"phase": "accepted", "container_id": container_id, "provider_id": post_id}
        )
    result = checked(
        await client.get(
            graph_url(post_id), headers=auth, params={"fields": "id,permalink"}
        )
    )
    if not result.get("id"):
        raise DeliveryError("Instagram post is awaiting confirmation.", retryable=True)
    return post_id, result.get("permalink") or ""
