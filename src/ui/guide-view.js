/* The how-to guide on the single-offer page. Pure string builders: the Worker
   renders this module too, so no DOM APIs. Every text field is escaped before
   the two inline marks the guide format allows (`code` and **bold**) are
   turned into tags, and every link passes `safeHttpsUrl` inside `externalLink`.
   Step screenshots are not rendered: no guide images ship with the site yet. */
import { escapeHTML as e } from './escape.js';
import { externalLink } from './offer-views.js';

/** @typedef {import('../domain/offer.js').Guide} Guide */
/** @typedef {import('../domain/offer.js').GuideStep} GuideStep */

/** Fragment id, so other views can link straight to the guide. */
export const GUIDE_ANCHOR = 'guide';

const TONE_LABEL = Object.freeze({ warn: '注意', danger: '风险' });
const BASIS_LABEL = Object.freeze({ official: '官方说明', community: '社区经验' });

/**
 * Escape, then apply inline marks. Runs on escaped text, so a mark can only
 * wrap already-escaped characters and never produces attributes.
 * @param {string} text
 * @returns {string}
 */
export function inlineMarks(text) {
  return e(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** @param {'official' | 'community'} basis */
const basisBadge = (basis) =>
  `<span class="guide-basis is-${basis === 'official' ? 'official' : 'community'}">${BASIS_LABEL[basis] ?? BASIS_LABEL.community}</span>`;

/** @param {import('../domain/offer.js').GuideNote} note */
const noteHTML = (note) => {
  const tone = note.tone === 'danger' ? 'danger' : 'warn';
  return `<aside class="guide-note is-${tone}"><strong class="guide-note-title"><span class="guide-note-tone">${TONE_LABEL[tone]}</span>${e(note.title)}</strong><p>${inlineMarks(note.text)}</p></aside>`;
};

/**
 * @param {GuideStep} step
 * @returns {string}
 */
function stepHTML(step) {
  const bullets = step.bullets.length
    ? `<ul class="guide-bullets">${step.bullets.map((b) => `<li>${inlineMarks(b)}</li>`).join('')}</ul>`
    : '';
  const link = step.link ? externalLink(step.link.url, step.link.label, 'guide-step-link') : '';
  const code = step.code ? `<pre class="guide-code"><code>${e(step.code)}</code></pre>` : '';
  return `<li class="guide-step"><p class="guide-step-text">${inlineMarks(step.text)}</p>${bullets}${code}${link}${step.notes.map(noteHTML).join('')}</li>`;
}

/**
 * Ordered list of steps; `start` keeps numbering continuous across phases.
 * @param {readonly GuideStep[]} steps
 * @param {number} start
 */
const stepsHTML = (steps, start) =>
  `<ol class="guide-steps"${start > 1 ? ` start="${start}"` : ''}>${steps.map(stepHTML).join('')}</ol>`;

/** @param {import('../domain/offer.js').FullGuide} guide */
function phasesHTML(guide) {
  const starts = guide.phases.map(
    (_, i) => 1 + guide.phases.slice(0, i).reduce((n, p) => n + p.steps.length, 0),
  );
  return guide.phases
    .map((phase, i) => {
      const steps = stepsHTML(phase.steps, starts[i] ?? 1);
      const note = phase.note ? `<p class="guide-phase-note">${inlineMarks(phase.note)}</p>` : '';
      return `<section class="guide-phase"><h3 class="guide-phase-title"><span class="guide-phase-index">阶段 ${i + 1}</span>${e(phase.title)}</h3>${note}${steps}</section>`;
    })
    .join('');
}

/** @param {import('../domain/offer.js').FullGuide['facts']} facts */
const factsHTML = (facts) =>
  facts.length
    ? `<h3 class="guide-subtitle">关键数据</h3><dl class="guide-facts">${facts
        .map(
          (f) =>
            `<div><dt>${e(f.label)}</dt><dd>${e(f.value)}${f.note ? `<small>${inlineMarks(f.note)}</small>` : ''}</dd></div>`,
        )
        .join('')}</dl>`
    : '';

/** @param {import('../domain/offer.js').FullGuide['faq']} faq */
const faqHTML = (faq) =>
  faq.length
    ? `<h3 class="guide-subtitle">常见问题</h3><div class="guide-faq">${faq
        .map(
          (q) =>
            `<details><summary>${e(q.question)}</summary><div class="guide-faq-answer">${basisBadge(q.basis)}<p>${inlineMarks(q.answer)}</p></div></details>`,
        )
        .join('')}</div>`
    : '';

/** @param {import('../domain/offer.js').FullGuide['references']} refs */
const referencesHTML = (refs) =>
  refs.length
    ? `<h3 class="guide-subtitle">参考来源</h3><ul class="guide-refs">${refs
        .map((r) => {
          const link = externalLink(r.url, r.title, 'guide-ref-link') || e(r.title);
          return `<li>${basisBadge(r.basis)}${link}</li>`;
        })
        .join('')}</ul>`
    : '';

/**
 * 「领取攻略」 section, or '' when the offer has no guide.
 * @param {Guide | null | undefined} guide
 * @returns {string}
 */
export function guideSection(guide) {
  if (!guide) return '';
  const lead =
    guide.kind === 'full'
      ? '按阶段完成以下步骤。规则可能随时调整，以官方页面为准。'
      : '简要步骤，规则以官方页面为准。';
  const body =
    guide.kind === 'full'
      ? `${phasesHTML(guide)}${factsHTML(guide.facts)}${faqHTML(guide.faq)}${referencesHTML(guide.references)}`
      : stepsHTML(guide.steps, 1);
  return `<section class="guide is-${guide.kind}" id="${GUIDE_ANCHOR}" aria-labelledby="guideTitle"><h2 class="dialog-section-title" id="guideTitle">领取攻略</h2><p class="guide-lead">${lead}</p>${body}</section>`;
}
