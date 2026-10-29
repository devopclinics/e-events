"""Named certificate layouts shared by verification HTML and PDF rendering.

Missing/unknown layout ids preserve the original classic frame for old snapshots.
"""
def certificate_layout(layout, primary, accent):
    if layout == "modern":
        return "modern", f".certificate{{border:0;border-left:40px solid {primary};border-top:10px solid {accent};box-shadow:none;text-align:left}}h2{{align-self:start;padding-left:0}}footer{{justify-content:space-between}}"
    if layout == "editorial":
        return "editorial", f".certificate{{border:3px solid {accent};box-shadow:inset 0 0 0 22px {primary};padding:80px}}.eyebrow{{font-weight:500;letter-spacing:.22em}}h2{{font-style:italic;border-bottom:1px solid {accent}}}"
    return "classic", ""
