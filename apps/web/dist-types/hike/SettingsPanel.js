import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Settings. Five of them, because a walking app that needs configuring has
 * already failed — these are the ones that genuinely differ between people
 * (how fast you walk) or between hikes (how far off the path is "off").
 */
import { useState } from "react";
import { DEFAULT_SETTINGS } from "./model.js";
export function SettingsPanel({ settings, onSave, onClose }) {
    const [draft, setDraft] = useState(settings);
    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
    return (_jsxs("div", { className: "panel", id: "settings", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h2", { children: "Settings" }), _jsx("button", { className: "close", onClick: onClose, "aria-label": "Close", children: "\u2715" })] }), _jsxs("div", { className: "panel-body set-body", children: [_jsxs("label", { children: ["Units", _jsxs("select", { value: draft.units, onChange: (e) => set("units", e.target.value), children: [_jsx("option", { value: "metric", children: "Metric (km, m)" }), _jsx("option", { value: "imperial", children: "Imperial (mi, ft)" })] })] }), _jsxs("label", { children: ["Pace on the flat (km/h)", _jsx("input", { type: "number", min: 2, max: 8, step: 0.5, value: draft.pace, onChange: (e) => set("pace", +e.target.value || DEFAULT_SETTINGS.pace) })] }), _jsx("p", { className: "hint", children: "Every time estimate is scaled to this, then adjusted to how you are actually walking once you are twenty minutes in." }), _jsxs("label", { children: ["Off-track warning (m)", _jsx("input", { type: "number", min: 15, max: 300, step: 5, value: draft.off, onChange: (e) => set("off", +e.target.value || DEFAULT_SETTINGS.off) })] }), _jsx("p", { className: "hint", children: "How far from the line counts as off it. Lower on a clear path, higher on open ground where the mapped line is a suggestion." }), _jsxs("label", { children: ["Buzz when off track", _jsx("input", { type: "checkbox", checked: draft.vib, onChange: (e) => set("vib", e.target.checked) })] }), _jsxs("label", { children: ["Warn when the ETA is after sunset", _jsx("input", { type: "checkbox", checked: draft.sun, onChange: (e) => set("sun", e.target.checked) })] })] }), _jsxs("div", { className: "panel-foot", children: [_jsx("button", { className: "primary", onClick: () => onSave(draft), children: "Save" }), _jsx("button", { onClick: onClose, children: "Cancel" })] })] }));
}
//# sourceMappingURL=SettingsPanel.js.map