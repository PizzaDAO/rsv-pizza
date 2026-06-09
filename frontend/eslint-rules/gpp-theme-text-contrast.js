/**
 * gpp/text-contrast
 * Flags warm light text utility classes (text-amber|yellow|orange-100|200) that lack a
 * [.gpp-theme_&]:text-* dark override. On the light "gpp-theme", `.gpp-theme .card` repaints
 * the panel white, so these near-white classes wash out to invisible.
 * Incidents: ricotta-92103, stromboli-58518.
 */
const WASHOUT = /\btext-(amber|yellow|orange)-(100|200)(?:\/\d{1,3})?\b/;
const HAS_OVERRIDE = /\[\.gpp-theme_&\]:text-/;

function check(context, node, raw) {
  if (typeof raw !== 'string') return;
  if (WASHOUT.test(raw) && !HAS_OVERRIDE.test(raw)) {
    context.report({
      node,
      messageId: 'washout',
      data: { cls: raw.match(WASHOUT)[0] },
    });
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Warm light text classes need a [.gpp-theme_&]:text-* dark override or they vanish on the light gpp-theme card.',
    },
    schema: [],
    messages: {
      washout:
        '"{{cls}}" has no [.gpp-theme_&]:text-* override and washes out to invisible on the light gpp-theme. Add a dark override, e.g. [.gpp-theme_&]:text-amber-900.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        check(context, node, node.value);
      },
      TemplateElement(node) {
        check(context, node, node.value && node.value.raw);
      },
    };
  },
};
