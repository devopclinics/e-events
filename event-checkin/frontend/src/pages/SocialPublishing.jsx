import React, { useEffect, useState } from "react";
import { api } from "../api";
import "./SocialPublishing.css";

const platforms = ["facebook", "instagram", "youtube", "tiktok"];
const formats = {
  facebook: ["text", "image", "video"],
  instagram: ["image", "video"],
  youtube: ["video"],
  tiktok: ["video", "image"],
};
const label = (value) =>
  ({ youtube: "YouTube", tiktok: "TikTok" })[value] ||
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const empty = () => ({
  title: "",
  notes: "",
  variants: [
    {
      platform: "facebook",
      format: "text",
      caption: "",
      title: "",
      asset_id: null,
      link_url: "",
      visibility: "public",
      made_for_kids: false,
      synthetic_media: false,
    },
  ],
});
const localDate = () => {
  const d = new Date(Date.now() + 3600000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const example = {
  title: "Create your next event with Festio",
  notes: "Imported from our content planning session.",
  variants: [
    {
      platform: "facebook",
      format: "text",
      caption:
        "Bring your guests together with Festio. Create your free event today.",
      link_url: "https://festio.events/create-invitation",
    },
  ],
};

export default function SocialPublishing({ legacy }) {
  const [posts, setPosts] = useState([]),
    [assets, setAssets] = useState([]),
    [capabilities, setCapabilities] = useState(null);
  const [draft, setDraft] = useState(empty),
    [editId, setEditId] = useState(null),
    [showEditor, setShowEditor] = useState(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [filter, setFilter] = useState("all"),
    [dates, setDates] = useState({});
  const [links, setLinks] = useState({}),
    [providerIds, setProviderIds] = useState({}),
    [showLegacy, setShowLegacy] = useState(false),
    [importText, setImportText] = useState("");
  const load = async () => {
    const [p, a, c] = await Promise.all([
      api.socialPosts(),
      api.socialAssets(),
      api.socialCapabilities(),
    ]);
    setPosts(p);
    setAssets(a);
    setCapabilities(c);
  };
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active)
        load().catch((e) => {
          if (active) setNotice(e.message);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (work, message) => {
    setBusy(true);
    setNotice("");
    try {
      await work();
      await load();
      setNotice(message);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const change = (index, patch) =>
    setDraft((d) => ({
      ...d,
      variants: d.variants.map((v, i) =>
        i === index ? { ...v, ...patch } : v,
      ),
    }));
  const assetFor = (v) => assets.find((a) => a.id === v.asset_id);
  const importDraft = () => {
    try {
      const value = JSON.parse(importText);
      if (
        !value.title ||
        !Array.isArray(value.variants) ||
        !value.variants.length ||
        value.variants.some((v) => !platforms.includes(v.platform))
      )
        throw new Error("Include a title and valid platform variants.");
      setDraft(value);
      setEditId(null);
      setShowEditor(true);
      setNotice(
        "Imported as an unsaved draft. Review each platform before saving.",
      );
    } catch (e) {
      setNotice(`Import failed: ${e.message}`);
    }
  };
  if (showLegacy)
    return (
      <>
        <button className="sp-back" onClick={() => setShowLegacy(false)}>
          ← Social publishing
        </button>
        {legacy}
      </>
    );
  return (
    <div className="sp-workspace">
      <header className="sp-heading">
        <div>
          <span className="sp-eyebrow">FESTIO SOCIAL · @festioevents</span>
          <h2>One idea. Every channel.</h2>
          <p>
            Prepare content, approve each version and follow every delivery.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setDraft(empty());
            setEditId(null);
            setShowEditor(true);
          }}
        >
          Create post
        </button>
      </header>
      {notice && (
        <div className="sp-notice" role="status">
          {notice}
        </div>
      )}
      {capabilities && (
        <div className="sp-readiness">
          <strong>
            {capabilities.publishing_enabled
              ? "Automatic delivery enabled"
              : "Automatic delivery paused"}
          </strong>
          <span>
            {capabilities.scheduler_enabled
              ? "Scheduling worker enabled."
              : "Scheduling worker paused."}{" "}
            Approved posts stay queued while delivery is paused.
          </span>
          <a href="?tab=social-settings">Manage account connections →</a>
        </div>
      )}
      <div className="sp-channels">
        {(capabilities?.channels || []).map((c) => (
          <div key={c.platform}>
            <strong>{label(c.platform)}</strong>
            <span>
              {c.mode === "manual"
                ? "Manual publishing"
                : c.configured
                  ? "Credentials saved · test connection"
                  : "Connection needed"}
            </span>
          </div>
        ))}
      </div>
      <details className="sp-import">
        <summary>Bring content from a planning session</summary>
        <p>
          Paste a post as JSON, or upload a JSON file. Upload images and videos
          below, then select them in each platform version.
        </p>
        <textarea
          aria-label="Import post JSON"
          rows={6}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={JSON.stringify(example, null, 2)}
        />
        <div className="sp-actions">
          <button disabled={busy} onClick={importDraft}>
            Review imported draft
          </button>
          <label className="sp-file">
            Choose JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                try {
                  if (e.target.files[0]?.size > 100000)
                    throw new Error("JSON file is too large");
                  if (e.target.files[0])
                    setImportText(await e.target.files[0].text());
                } catch (error) {
                  setNotice(error.message);
                }
              }}
            />
          </label>
          <button
            className="secondary"
            onClick={() => setImportText(JSON.stringify(example, null, 2))}
          >
            Load example
          </button>
        </div>
      </details>
      <details className="sp-library">
        <summary>
          Media library · {assets.length}{" "}
          {assets.length === 1 ? "asset" : "assets"}
        </summary>
        <p>
          Upload JPEG, PNG or MP4 files. Media links are accessible to anyone
          with the link so platforms can retrieve them.
        </p>
        <label className="sp-file">
          {busy ? "Working…" : "Upload media"}
          <input
            type="file"
            accept="image/jpeg,image/png,video/mp4"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files[0];
              if (file)
                run(
                  () => api.socialUploadAsset(file),
                  "Media uploaded. Select it in your post.",
                );
              e.target.value = "";
            }}
          />
        </label>
        <div className="sp-assets">
          {assets.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
              {a.mime.startsWith("image/") ? (
                <img src={a.url} alt="" loading="lazy" />
              ) : (
                <span className="sp-video-symbol">▶</span>
              )}
              <b>{a.filename}</b>
              <small>{(a.size / 1024 / 1024).toFixed(1)} MB</small>
            </a>
          ))}
        </div>
      </details>
      {showEditor && (
        <form
          className="sp-editor"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              if (editId) await api.socialEditPost(editId, draft);
              else await api.socialCreatePost(draft);
              setShowEditor(false);
            }, "Draft saved. Submit it for review when ready.");
          }}
        >
          <header>
            <h3>{editId ? "Edit draft" : "Create a draft"}</h3>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setShowEditor(false)}
            >
              Close editor
            </button>
          </header>
          <label>
            Post name
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Planning notes
            <textarea
              rows={2}
              value={draft.notes || ""}
              maxLength={10000}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          {draft.variants.map((v, i) => (
            <fieldset key={i}>
              <legend>{label(v.platform)} version</legend>
              <div className="sp-fields">
                <label>
                  Platform
                  <select
                    aria-label="Platform"
                    value={v.platform}
                    onChange={(e) =>
                      change(i, {
                        platform: e.target.value,
                        format: formats[e.target.value][0],
                        asset_id: null,
                      })
                    }
                  >
                    {platforms.map((p) => (
                      <option
                        key={p}
                        value={p}
                        disabled={draft.variants.some(
                          (other, j) => j !== i && other.platform === p,
                        )}
                      >
                        {label(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Format
                  <select
                    aria-label="Format"
                    value={v.format}
                    onChange={(e) =>
                      change(i, { format: e.target.value, asset_id: null })
                    }
                  >
                    {formats[v.platform].map((f) => (
                      <option key={f} value={f}>
                        {label(
                          f === "video" && v.platform === "instagram"
                            ? "reel"
                            : f,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(v.platform === "youtube" || v.format === "video") && (
                <label>
                  Video title
                  <input
                    value={v.title || ""}
                    required={v.platform === "youtube"}
                    maxLength={100}
                    onChange={(e) => change(i, { title: e.target.value })}
                  />
                </label>
              )}
              <label>
                {v.platform === "youtube" ? "Description" : "Caption"}
                <textarea
                  required
                  rows={4}
                  maxLength={v.platform === "instagram" ? 2200 : 5000}
                  value={v.caption || ""}
                  onChange={(e) => change(i, { caption: e.target.value })}
                />
              </label>
              {v.format !== "text" && (
                <label>
                  Media
                  <select
                    aria-label="Media"
                    required
                    value={v.asset_id || ""}
                    onChange={(e) => change(i, { asset_id: e.target.value })}
                  >
                    <option value="">Select uploaded media</option>
                    {assets
                      .filter((a) =>
                        v.format === "video"
                          ? a.mime === "video/mp4"
                          : v.platform === "instagram"
                            ? a.mime === "image/jpeg"
                            : a.mime.startsWith("image/"),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.filename}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {v.platform === "facebook" && v.format === "text" && (
                <label>
                  Link
                  <input
                    type="url"
                    value={v.link_url || ""}
                    onChange={(e) => change(i, { link_url: e.target.value })}
                  />
                </label>
              )}
              {v.platform === "youtube" && (
                <>
                  <label>
                    Visibility
                    <select
                      aria-label="Visibility"
                      value={v.visibility || "public"}
                      onChange={(e) =>
                        change(i, { visibility: e.target.value })
                      }
                    >
                      <option value="public">Public</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="private">Private</option>
                    </select>
                  </label>
                  <label className="sp-check">
                    <input
                      type="checkbox"
                      checked={!!v.made_for_kids}
                      onChange={(e) =>
                        change(i, { made_for_kids: e.target.checked })
                      }
                    />
                    Made for kids
                  </label>
                  <label className="sp-check">
                    <input
                      type="checkbox"
                      checked={!!v.synthetic_media}
                      onChange={(e) =>
                        change(i, { synthetic_media: e.target.checked })
                      }
                    />
                    Contains realistic altered or synthetic media
                  </label>
                </>
              )}
              {v.platform === "tiktok" && (
                <p className="sp-hint">
                  TikTok delivery is manual. Download this asset, publish in
                  TikTok, then save the published link here.
                </p>
              )}
              {draft.variants.length > 1 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      variants: draft.variants.filter((_, j) => i !== j),
                    })
                  }
                >
                  Remove version
                </button>
              )}
            </fieldset>
          ))}
          <div className="sp-actions">
            {draft.variants.length < 4 && (
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  const p = platforms.find(
                    (p) => !draft.variants.some((v) => v.platform === p),
                  );
                  setDraft({
                    ...draft,
                    variants: [
                      ...draft.variants,
                      {
                        ...empty().variants[0],
                        platform: p,
                        format: formats[p][0],
                      },
                    ],
                  });
                }}
              >
                Add platform version
              </button>
            )}
            <button disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
          </div>
        </form>
      )}
      <div className="sp-toolbar">
        <label>
          Show
          <select
            aria-label="Show posts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {[
              "all",
              "draft",
              "review",
              "approved",
              "scheduled",
              "complete",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => run(async () => {}, "Publishing status refreshed.")}
        >
          Refresh
        </button>
        <button className="secondary" onClick={() => setShowLegacy(true)}>
          Previous content calendar
        </button>
      </div>
      <div className="sp-posts">
        {posts
          .filter((p) => filter === "all" || p.status === filter)
          .map((p) => (
            <article className="sp-post" key={p.id}>
              <header>
                <div>
                  <span className={`sp-status sp-status-${p.status}`}>
                    {label(p.status)}
                  </span>
                  <h3>{p.title}</h3>
                </div>
                <time>
                  {p.scheduled_at
                    ? new Date(p.scheduled_at).toLocaleString()
                    : new Date(p.created_at).toLocaleDateString()}
                </time>
              </header>
              {p.notes && <p>{p.notes}</p>}
              {p.approved_by && <small>Approved by {p.approved_by}</small>}
              <div className="sp-previews">
                {p.variants.map((v) => {
                  const a = assetFor(v);
                  const d = p.deliveries.find((d) => d.platform === v.platform);
                  return (
                    <section key={v.platform}>
                      <header>
                        <strong>{label(v.platform)}</strong>
                        <span>
                          {label(
                            v.format === "video" && v.platform === "instagram"
                              ? "reel"
                              : v.format,
                          )}
                        </span>
                      </header>
                      {a &&
                        (v.format === "image" ? (
                          <img src={a.url} alt={a.filename} loading="lazy" />
                        ) : (
                          <video src={a.url} controls preload="metadata" />
                        ))}
                      {v.title && <h4>{v.title}</h4>}
                      <p className="sp-caption">{v.caption}</p>
                      {v.link_url && (
                        <a href={v.link_url} target="_blank" rel="noreferrer">
                          {v.link_url}
                        </a>
                      )}
                      {v.platform === "youtube" && (
                        <small>
                          Visibility: {v.visibility || "public"} ·{" "}
                          {v.made_for_kids
                            ? "Made for kids"
                            : "Not made for kids"}
                        </small>
                      )}
                      {d && (
                        <div className="sp-delivery">
                          <strong>{label(d.status)}</strong>
                          {d.attempts > 0 && (
                            <small>
                              {" "}
                              · {d.attempts} attempt
                              {d.attempts === 1 ? "" : "s"}
                            </small>
                          )}
                          {d.error && <p>{d.error}</p>}
                          {d.url && (
                            <a href={d.url} target="_blank" rel="noreferrer">
                              View published post ↗
                            </a>
                          )}
                          {d.status === "manual" &&
                            capabilities?.can_approve && (
                              <>
                                <p>
                                  Publish this version in TikTok, then confirm
                                  its link.
                                </p>
                                {a && (
                                  <a href={`${a.url}&download=true`}>
                                    Download media ↓
                                  </a>
                                )}
                                <input
                                  aria-label="Published TikTok link"
                                  type="url"
                                  placeholder="https://www.tiktok.com/@festioevents/video/…"
                                  value={links[d.id] || ""}
                                  onChange={(e) =>
                                    setLinks({
                                      ...links,
                                      [d.id]: e.target.value,
                                    })
                                  }
                                />
                                <button
                                  disabled={busy || !links[d.id]}
                                  onClick={() =>
                                    run(
                                      () =>
                                        api.socialDeliveryAction(
                                          d.id,
                                          "manual",
                                          { url: links[d.id] },
                                        ),
                                      "Manual delivery confirmed.",
                                    )
                                  }
                                >
                                  Confirm published link
                                </button>
                              </>
                            )}
                          {d.status === "failed" &&
                            p.status === "scheduled" &&
                            capabilities?.can_approve && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(
                                    () =>
                                      api.socialDeliveryAction(d.id, "retry"),
                                    "Delivery queued for retry.",
                                  )
                                }
                              >
                                Retry delivery
                              </button>
                            )}
                          {d.status === "needs_review" &&
                            capabilities?.can_approve && (
                              <>
                                <p>
                                  Check the account for this post before taking
                                  action.
                                </p>
                                <input
                                  aria-label={`${v.platform} published link`}
                                  placeholder="Published post URL"
                                  value={links[d.id] || ""}
                                  onChange={(e) =>
                                    setLinks({
                                      ...links,
                                      [d.id]: e.target.value,
                                    })
                                  }
                                />
                                <input
                                  aria-label={`${v.platform} post ID`}
                                  placeholder="Provider post ID"
                                  value={providerIds[d.id] || ""}
                                  onChange={(e) =>
                                    setProviderIds({
                                      ...providerIds,
                                      [d.id]: e.target.value,
                                    })
                                  }
                                />
                                <button
                                  disabled={
                                    busy || !links[d.id] || !providerIds[d.id]
                                  }
                                  onClick={() =>
                                    run(
                                      () =>
                                        api.socialDeliveryAction(
                                          d.id,
                                          "reconcile",
                                          {
                                            url: links[d.id],
                                            provider_id: providerIds[d.id],
                                          },
                                        ),
                                      "Published delivery reconciled.",
                                    )
                                  }
                                >
                                  Confirm existing post
                                </button>
                              </>
                            )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              <footer className="sp-actions">
                {p.status === "draft" && (
                  <>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setDraft({
                          title: p.title,
                          notes: p.notes,
                          variants: p.variants,
                        });
                        setEditId(p.id);
                        setShowEditor(true);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api.socialPostAction(p.id, "submit"),
                          "Post submitted for review.",
                        )
                      }
                    >
                      Submit for review
                    </button>
                  </>
                )}
                {p.status === "review" && capabilities?.can_approve && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.socialPostAction(p.id, "approve"),
                        "Post approved. Choose its publishing time.",
                      )
                    }
                  >
                    Approve these versions
                  </button>
                )}
                {["review", "approved", "cancelled"].includes(p.status) &&
                  capabilities?.can_approve && (
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        p.deliveries.some(
                          (d) => d.attempts || d.status === "published",
                        )
                      }
                      onClick={() =>
                        run(
                          () => api.socialPostAction(p.id, "draft"),
                          "Post returned to draft. Approval cleared.",
                        )
                      }
                    >
                      Return to draft
                    </button>
                  )}
                {p.status === "approved" && capabilities?.can_approve && (
                  <>
                    <label>
                      Publish at (
                      {Intl.DateTimeFormat().resolvedOptions().timeZone})
                      <input
                        type="datetime-local"
                        value={dates[p.id] || localDate()}
                        onChange={(e) =>
                          setDates({ ...dates, [p.id]: e.target.value })
                        }
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api.socialPostAction(p.id, "schedule", {
                              scheduled_at: new Date(
                                dates[p.id] || localDate(),
                              ).toISOString(),
                            }),
                          "Post scheduled. Delivery depends on account connections and publishing being enabled.",
                        )
                      }
                    >
                      Schedule approved post
                    </button>
                  </>
                )}
                {p.status === "scheduled" && capabilities?.can_approve && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.socialPostAction(p.id, "cancel"),
                        "Remaining deliveries cancelled.",
                      )
                    }
                  >
                    Cancel remaining deliveries
                  </button>
                )}
              </footer>
            </article>
          ))}
        {!posts.length && (
          <div className="sp-empty">
            <h3>Your first campaign starts here.</h3>
            <p>
              Create a draft or import content from a planning session, then
              review each platform version before scheduling.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
