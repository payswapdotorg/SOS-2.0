/**
 * @sos-2/optimization — SOS 2.0 multi-objective + quality-diversity
 * evaluation (Work Order W7; requirements R12, R28; spec/architecture.md
 * §9, §11; spec/architecture-lock.md forbids a single global architecture
 * score as the sole authority and a universal winner collapsing the
 * repertoire).
 *
 *   - PARETO: non-dominated sorting over TYPED objectives on the §11
 *     behavioral dimensions (axis vocabulary imported from @sos-2/packages,
 *     six core axes with frozen natural directions); returns the Pareto
 *     FRONT — never a single winner; the fronts PARTITION the input.
 *   - QUALITY-DIVERSITY REPERTOIRE: a MAP-Elites-style archive — typed
 *     behavior descriptors, per-cell elites, deterministic and
 *     order-independent (confluent) updates; materially different
 *     high-performing solution families are retained, never collapsed.
 *   - UNCERTAINTY PRESERVED END-TO-END: every candidate entering evaluation
 *     MUST carry a CarriedUncertainty payload (qualitative class + sample
 *     size + calibrated probability with its calibration ref when
 *     calibrated); results never collapse to point scores alone. An
 *     uncertainty-stripped candidate is rejected loudly.
 *
 * EXPORT DISCIPLINE (binding): the objective-axis vocabulary and the
 * uncertainty-class vocabulary are imported from @sos-2/packages /
 * @sos-2/evidence and never redefined; canonical serialization and spine id
 * checks come from @sos-2/semantic-spine. Nothing here duplicates an
 * authority.
 */

export * from './errors.js';
export * from './uncertainty.js';
export * from './objectives.js';
export * from './pareto.js';
export * from './repertoire.js';
