import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "What is around me" — the bottom sheet.
 *
 * Five tabs, because what a walker wants to know changes with the situation:
 * water and shelter when it is going wrong, sights when it is going well,
 * food when arriving somewhere. "Nearby" sorts by straight-line distance
 * because that is what matters when you are standing still; "Ahead" sorts by
 * distance along the track because that is what matters when you are moving.
 */
import { PoiCard, Sheet } from "@slownav/ui";
import { haversine } from "@slownav/core";
import { useMemo, useState } from "react";
const TABS = [
    { id: "nearby", label: "Nearby" },
    { id: "ahead", label: "Ahead" },
    { id: "water", label: "Water & shelter" },
    { id: "sights", label: "Sights" },
    { id: "food", label: "Food & services" },
];
const GROUP_TITLES = {
    water: "Water",
    hut: "Shelter",
    peak: "Peaks & cols",
    sight: "Sights",
    place: "Places",
    food: "Food & drink",
    shop: "Shops",
    service: "Services",
};
/** Which tab a sight belongs to when opened from a map marker. */
export function tabForSight(s) {
    if (s.group === "water" || s.group === "hut")
        return "water";
    if (s.group === "food" || s.group === "shop" || s.group === "service")
        return "food";
    return "sights";
}
export function NearbySheet({ sights, status, progress, position, fmt, open, onToggle, tab, onTab, onShowOnMap, expandedIds, onExpand, }) {
    const [search] = useState("");
    const { list, title } = useMemo(() => {
        if (!sights)
            return { list: [], title: "Nearby" };
        // Straight-line distance from here; falls back to distance along the
        // track before there is a position.
        const withStraight = sights.map((s) => ({
            s,
            straight: position ? haversine(position, [s.lat, s.lon]) : Math.abs(s.prog - progress),
        }));
        switch (tab) {
            case "nearby":
                return {
                    title: "Nearby (1.5 km)",
                    list: withStraight
                        .filter((x) => x.straight <= 1500)
                        .sort((a, b) => a.straight - b.straight)
                        .slice(0, 40)
                        .map((x) => x.s),
                };
            case "ahead":
                return {
                    title: "Ahead (6 km)",
                    list: sights
                        .filter((s) => s.prog > progress && s.prog - progress <= 6000)
                        .sort((a, b) => a.prog - b.prog),
                };
            case "water":
                return {
                    title: "Water & shelter",
                    list: sights
                        .filter((s) => s.group === "water" || s.group === "hut")
                        .sort((a, b) => a.prog - b.prog),
                };
            case "sights":
                return {
                    title: "Sights",
                    list: sights
                        .filter((s) => s.group === "sight" || s.group === "peak" || s.group === "place")
                        .sort((a, b) => a.prog - b.prog),
                };
            default:
                return {
                    title: "Food & services",
                    list: sights
                        .filter((s) => /^(food|shop|service)$/.test(s.group))
                        .sort((a, b) => a.prog - b.prog),
                };
        }
    }, [sights, tab, progress, position, search]);
    const label = (s) => {
        const along = s.prog - progress;
        const off = s.lateral > 60 ? ` · ${fmt.dist(s.lateral)} off the track` : "";
        return `${along >= 0 ? "in " : "back "}${fmt.dist(Math.abs(along))}${off}`;
    };
    let body;
    if (!sights) {
        body = (_jsx("div", { className: "sheet-empty", children: status === "loading"
                ? "Looking up sights along the route…"
                : status === "error"
                    ? "Couldn't load sights (no connection?). Prepare the hike for offline while you have signal."
                    : "No sights loaded." }));
    }
    else if (!list.length) {
        body = _jsx("div", { className: "sheet-empty", children: "Nothing here." });
    }
    else {
        let lastGroup = "";
        body = list.map((s) => {
            // Only the mixed tabs need group headings; the rest are already one kind.
            let heading = null;
            if (tab === "nearby" || tab === "ahead") {
                const g = GROUP_TITLES[s.group] ?? "Other";
                if (g !== lastGroup) {
                    heading = g;
                    lastGroup = g;
                }
            }
            const meta = [
                s.ele ? `${s.ele} m` : "",
                s.tags.opening_hours ? `Hours: ${s.tags.opening_hours}` : "",
                s.tags.phone ?? "",
                s.tags["description:en"] || s.tags.description || "",
            ]
                .filter(Boolean)
                .join(" · ");
            return (_jsxs("div", { children: [heading && _jsx("div", { className: "group-title", children: heading }), _jsxs(PoiCard, { name: s.name, kind: s.kind, distance: label(s), passed: s.prog < progress - 100, open: expandedIds.has(s.id), onToggle: () => onExpand(s.id), children: [s.wiki?.extract && _jsx("p", { className: "fact", children: s.wiki.extract }), meta && _jsx("p", { className: "meta", children: meta }), _jsxs("div", { className: "actions", children: [_jsx("button", { onClick: () => onShowOnMap(s), children: "Show on map" }), s.wiki && (_jsxs("a", { className: "btn", href: s.wiki.url, target: "_blank", rel: "noopener noreferrer", children: ["Wikipedia", s.wiki.lang !== "en" ? ` (${s.wiki.lang.toUpperCase()})` : ""] })), s.tags.website && (_jsx("a", { className: "btn", href: s.tags.website, target: "_blank", rel: "noopener noreferrer", children: "Website" })), _jsx("a", { className: "btn", href: `https://www.google.com/search?q=${encodeURIComponent(`${s.name} Picos de Europa`)}`, target: "_blank", rel: "noopener noreferrer", children: "Search" }), _jsx("a", { className: "btn", href: `https://www.google.com/maps?q=${s.lat},${s.lon}`, target: "_blank", rel: "noopener noreferrer", children: "Maps" })] })] })] }, s.id));
        });
    }
    return (_jsx(Sheet, { title: title, count: sights ? list.length : undefined, open: open, onToggle: onToggle, tabs: TABS, activeTab: tab, onTab: (id) => onTab(id), children: body }));
}
//# sourceMappingURL=NearbySheet.js.map