/* @ds-bundle: {"format":4,"namespace":"Commons","components":[{"name":"Button"},{"name":"TextField"},{"name":"Checkbox"},{"name":"StatusBadge"},{"name":"IssueCard"},{"name":"FeatureItem"},{"name":"CalloutBand"},{"name":"StatusTimeline"},{"name":"InlineSignup"}]} */
(function () {
  var React = window.React, h = React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }
  var uid = 0; function useId(given) { var r = React.useRef(given || "cv-" + (++uid)); return r.current; }

  function Button(p) {
    var variant = p.variant || "secondary", size = p.size || "md";
    var rest = Object.assign({}, p); delete rest.variant; delete rest.size; delete rest.className;
    return h("button", Object.assign({ type: "button" }, rest, { className: cx("cv-btn", "cv-btn-" + variant, size === "sm" && "cv-btn-sm", p.className) }), p.children);
  }

  function TextField(p) {
    var id = useId(p.id), hintId = id + "-hint";
    var rest = Object.assign({}, p); ["label", "hint", "error", "className", "hideLabel"].forEach(function (k) { delete rest[k]; });
    var msg = p.error || p.hint;
    return h("div", { className: cx("cv-field", p.error && "is-error", p.className) },
      p.label && h("label", { htmlFor: id, className: cx("cv-field-label", p.hideLabel && "cv-sr") }, p.label),
      h("input", Object.assign({ type: "text" }, rest, { id: id, className: "cv-input", "aria-invalid": p.error ? true : undefined, "aria-describedby": msg ? hintId : undefined })),
      msg && h("p", { id: hintId, className: "cv-field-hint" }, p.error ? "⚠ " + p.error : p.hint));
  }

  function Checkbox(p) {
    var id = useId(p.id);
    var rest = Object.assign({}, p); delete rest.label; delete rest.className;
    return h("label", { htmlFor: id, className: cx("cv-check", p.className) },
      h("input", Object.assign({ type: "checkbox" }, rest, { id: id })),
      h("span", { className: "cv-check-box", "aria-hidden": true }),
      h("span", { className: "cv-check-label" }, p.label || p.children));
  }

  var STATUS = {
    reported: ["Reported", "○"], reviewing: ["Under review", "…"], "in-progress": ["In progress", "→"],
    resolved: ["Resolved", "✓"], urgent: ["Urgent", "!"], closed: ["Closed", "–"]
  };
  function StatusBadge(p) {
    var s = p.status || "reported", d = STATUS[s] || STATUS.reported;
    return h("span", { className: cx("cv-badge", "cv-badge-" + s, p.className) },
      h("span", { className: "cv-badge-glyph", "aria-hidden": true }, d[1]), p.children || d[0]);
  }

  function IssueCard(p) {
    var Tag = p.href ? "a" : "article";
    return h(Tag, { className: cx("cv-issue", p.href && "is-link", p.className), href: p.href },
      h("div", { className: "cv-issue-frame" }, p.media),
      h("span", { className: "cv-issue-rules", "aria-hidden": true }, h("i"), h("i")),
      h("div", { className: "cv-issue-head" },
        h("h3", { className: "cv-issue-title" }, p.title),
        p.status && h(StatusBadge, { status: p.status })),
      (p.location || p.time) && h("p", { className: "cv-issue-meta" }, [p.location, p.time].filter(Boolean).join(" · ")),
      p.followers != null && h("p", { className: "cv-issue-follow" }, p.followers + (p.followers === 1 ? " neighbour follows this" : " neighbours follow this")));
  }

  function FeatureItem(p) {
    return h("div", { className: cx("cv-feature", p.className) },
      p.icon && h("div", { className: "cv-feature-icon" }, p.icon),
      h("h3", { className: "cv-feature-title" }, p.title),
      h("p", { className: "cv-feature-body" }, p.children));
  }

  function CalloutBand(p) {
    return h("section", { className: cx("cv-band", p.art && "has-art", p.className) },
      h("div", { className: "cv-band-copy" },
        h("h2", { className: "cv-band-title" }, p.title),
        p.children && h("div", { className: "cv-band-body" }, p.children),
        p.action && h("div", { className: "cv-band-action" }, p.action)),
      p.art && h("div", { className: "cv-band-art" }, p.art));
  }

  function StatusTimeline(p) {
    var steps = p.steps || [];
    return h("ol", { className: cx("cv-timeline", p.className) }, steps.map(function (s, i) {
      return h("li", { key: i, className: cx("cv-step", "is-" + (s.state || "upcoming")), "aria-current": s.state === "current" ? "step" : undefined },
        h("span", { className: "cv-step-dot", "aria-hidden": true }, s.state === "done" ? "✓" : ""),
        h("div", { className: "cv-step-text" },
          h("p", { className: "cv-step-title" }, s.title, s.state === "current" && h("span", { className: "cv-sr" }, " (current)")),
          (s.date || s.note) && h("p", { className: "cv-step-note" }, [s.date, s.note].filter(Boolean).join(" — "))));
    }));
  }

  function InlineSignup(p) {
    var st = React.useState(""), v = st[0], set = st[1];
    return h("form", { className: cx("cv-signup", p.className), onSubmit: function (e) { e.preventDefault(); p.onSubmit && p.onSubmit(v); } },
      h("div", { className: "cv-signup-row" },
        h(TextField, { type: "email", label: p.label || "Email address", hideLabel: true, placeholder: p.placeholder || "Enter your email", value: v, onChange: function (e) { set(e.target.value); }, required: true }),
        h(Button, { type: "submit", variant: "primary" }, p.cta || "Subscribe")),
      p.consent && h(Checkbox, { label: p.consent, required: true }));
  }

  window.Commons = Object.assign(window.Commons || {}, {
    Button: Button, TextField: TextField, Checkbox: Checkbox, StatusBadge: StatusBadge, IssueCard: IssueCard,
    FeatureItem: FeatureItem, CalloutBand: CalloutBand, StatusTimeline: StatusTimeline, InlineSignup: InlineSignup
  });
})();
