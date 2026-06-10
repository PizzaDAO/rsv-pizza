/**
 * gpp/text-contrast       (config: error) — all hues at shade 100|200
 * gpp/text-contrast-300   (config: warn)  — all hues at shade 300
 * Flags light colored text classes lacking a [.gpp-theme_&]:text-* dark override.
 * On the light gpp-theme, `.gpp-theme .card` is white, so these wash out.
 * Incidents: ricotta-92103, stromboli-58518, panzerotti-58519.
 */
const HUES =
  'amber|yellow|orange|red|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|lime';
const HAS_OVERRIDE = /\[\.gpp-theme_&\]:text-/;

function makeRule(shadeAlt) {
  const re = new RegExp(`\\btext-(?:${HUES})-(?:${shadeAlt})(?:\\/\\d{1,3})?\\b`);
  return {
    meta: {
      type: 'problem',
      docs: {
        description:
          'Light colored text needs a [.gpp-theme_&]:text-* dark override or it washes out on the light gpp-theme card.',
      },
      schema: [],
      messages: {
        washout:
          '"{{cls}}" has no [.gpp-theme_&]:text-* override and is low-contrast/invisible on the light gpp-theme card. Add a dark override, e.g. [.gpp-theme_&]:text-<hue>-800.',
      },
    },
    create(context) {
      function check(node, raw) {
        if (typeof raw !== 'string') return;
        const m = raw.match(re);
        if (m && !HAS_OVERRIDE.test(raw)) {
          context.report({ node, messageId: 'washout', data: { cls: m[0] } });
        }
      }
      return {
        Literal(node) {
          check(node, node.value);
        },
        TemplateElement(node) {
          check(node, node.value && node.value.raw);
        },
      };
    },
  };
}

export const rules = {
  'text-contrast': makeRule('100|200'),
  'text-contrast-300': makeRule('300'),
};

export default { rules };
