export const CSS = `
.andes-relay{--ar-canvas:var(--canvas,#F2F6F6);--ar-surface:var(--surface,#FCFDFD);--ar-ink:var(--ink,#173139);--ar-muted:var(--muted,#4D6268);--ar-primary:var(--primary,#166675);--ar-border:var(--border,#CAD6D8);color:var(--ar-ink);font:400 16px/1.5 var(--font-ui,system-ui,-apple-system,sans-serif);max-width:850px;margin-inline:auto;overflow-wrap:anywhere}
.andes-relay *{box-sizing:border-box}.andes-relay [hidden]{display:none!important}
.andes-relay h2{font-size:24px;line-height:1.25;letter-spacing:-.025em;margin:8px 0 12px;font-weight:650}
.andes-relay p{max-width:68ch;margin:0 0 12px}.andes-relay .ar-kicker{font-size:14px;font-weight:650;letter-spacing:.035em;margin:0}
.andes-relay .ar-muted{color:var(--ar-muted);font-size:14px}
.andes-relay figure{margin:24px 0 20px}.andes-relay .iso-plate{background:var(--ar-surface);border:1px solid var(--ar-border);border-radius:8px;padding:16px 20px 12px;overflow:hidden}
.andes-relay .ar-corners{display:flex;justify-content:space-between;gap:16px;color:var(--ar-muted);font-size:14px}
.andes-relay .ar-corners:last-child{align-items:flex-end;min-height:42px;padding-top:8px}.andes-relay [data-readout]{max-width:65%;text-align:right;font-weight:600;color:var(--ar-ink)}
.andes-relay svg{display:block;width:100%;height:auto;overflow:visible}
.andes-relay figcaption{font-size:14px;color:var(--ar-muted);margin-top:12px;max-width:65ch}
.andes-relay .ar-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:20px 0}
.andes-relay button{appearance:none;min-height:52px;width:100%;padding:10px 12px;border:1px solid var(--ar-muted);border-radius:6px;background:var(--ar-surface);color:var(--ar-ink);font:600 16px/1.35 system-ui,-apple-system,sans-serif;text-align:left;cursor:pointer;touch-action:manipulation}
.andes-relay button[aria-pressed=true]{background:var(--ar-primary);border-color:var(--ar-primary);color:var(--on-primary,#F9FCFC)}
.andes-relay button:hover{box-shadow:inset 0 0 0 1px currentColor}.andes-relay button:focus-visible{outline:3px solid var(--ar-primary);outline-offset:3px}
.andes-relay button .ar-number{display:block;font-size:14px;margin-bottom:4px;font-weight:400}
.andes-relay .ar-explanation{margin-block:20px 24px}.andes-relay .ar-explanation strong{display:block;font-size:18px;line-height:1.4;margin-bottom:8px}
.andes-relay dl{margin:24px 0}.andes-relay .ar-fact{display:grid;grid-template-columns:1fr 1.3fr;gap:12px;border-top:1px solid var(--ar-border);padding:12px 0}
.andes-relay .ar-fact:last-child{border-bottom:1px solid var(--ar-border)}.andes-relay dt{color:var(--ar-muted)}.andes-relay dd{margin:0;font-weight:600}
.andes-relay ol{padding-inline-start:24px}.andes-relay li{padding-inline-start:4px;margin-bottom:16px}.andes-relay li strong{display:block;margin-bottom:4px}
.andes-relay .iso-fill{fill:var(--ar-surface);stroke:none}.andes-relay .iso-top{fill:#E9F0F0;stroke:none}
.andes-relay .iso-shade{stroke:none}.andes-relay .iso-shade[data-shade="0"]{fill:#A5B8BD}.andes-relay .iso-shade[data-shade="1"]{fill:#BBCCD0}.andes-relay .iso-shade[data-shade="2"]{fill:#CEDBDD}.andes-relay .iso-shade[data-shade="3"]{fill:#DDE7E8}
.andes-relay .iso-line{fill:none;stroke:#647D85;stroke-width:.7;stroke-linecap:round;stroke-linejoin:round}
.andes-relay .iso-line[data-tone="hi"]{stroke:#294953}.andes-relay .iso-line[data-tone="mid"]{stroke:#4D6268}.andes-relay .iso-line[data-tone="faint"]{stroke:#A5B8BD}
.andes-relay .iso-face-text{fill:#4D6268;font-family:system-ui,sans-serif;letter-spacing:.06em}
@media(max-width:430px){.andes-relay .iso-plate{padding:14px 10px 12px}.andes-relay .ar-corners{gap:8px}.andes-relay .ar-corners:last-child{font-size:14px}.andes-relay .ar-fact{grid-template-columns:1fr;gap:4px}.andes-relay button{padding:10px;min-height:72px}}
@media(forced-colors:active){.andes-relay button[aria-pressed=true]{border:3px solid Highlight}.andes-relay .iso-line{stroke:CanvasText}.andes-relay .iso-fill,.andes-relay .iso-top,.andes-relay .iso-shade{fill:Canvas}}
`;
