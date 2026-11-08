"""Named certificate layouts shared by verification HTML and PDF rendering.

Missing/unknown layout ids preserve the original classic frame for old snapshots.
"""
def certificate_layout(layout, primary, accent):
    if layout == "royal":
        return layout, f".certificate{{border:1px solid #d5b88a;border-left:65px solid {primary};border-top:8px solid {accent};background:#fffaf3;box-shadow:none}}h2{{font-style:italic}}.eyebrow{{font-size:30px;letter-spacing:0;text-transform:none}}"
    if layout == "heritage":
        return layout, f".certificate{{background:#fbf7e9;border:14px solid {primary};box-shadow:inset 0 0 0 3px {accent}}}h2{{font-style:italic}}.eyebrow{{font:36px Georgia;letter-spacing:.04em}}"
    if layout == "midnight":
        return layout, f".certificate{{background:{primary};color:#f8f3ea;border:0;border-left:35px solid {accent};box-shadow:none;text-align:left}}.eyebrow{{font:34px Arial;letter-spacing:0;text-transform:none}}h2{{align-self:start;padding-left:0}}footer img.signature{{background:#fff;border-radius:4px;padding:4px}}"
    if layout == "ivory":
        return layout, f".certificate{{background:#fffefa;border:1px solid #d9cbd3;box-shadow:inset 0 0 0 20px #fffefa;padding:75px}}.eyebrow{{font:34px Georgia;letter-spacing:0;text-transform:none}}h2{{font-style:italic}}footer{{border-top:1px solid {accent};padding-top:20px}}"
    if layout == "modern":
        return "modern", f".certificate{{border:0;border-left:40px solid {primary};border-top:10px solid {accent};box-shadow:none;text-align:left}}h2{{align-self:start;padding-left:0}}footer{{justify-content:space-between}}"
    if layout == "editorial":
        return "editorial", f".certificate{{border:3px solid {accent};box-shadow:inset 0 0 0 22px {primary};padding:80px}}.eyebrow{{font-weight:500;letter-spacing:.22em}}h2{{font-style:italic;border-bottom:1px solid {accent}}}"
    return "classic", ""
