# Probabilistic and Statistical Learning

Probability represents uncertainty; it does not manufacture certainty.

Evidence strength:
controlled intervention > quasi-experimental evidence > observational comparison > anecdote/assertion

Hierarchical learning:
global -> domain -> niche -> system -> current context

Store:
model, evidence set, sample size, context, time window, calibration status and uncertainty.

For simple binary package outcomes, a Beta posterior can be used as a baseline. More advanced implementations may use hierarchical Bayesian models.

Never assume:
P(A+B) = P(A)P(B)
unless independence is justified.

Exploration and exploitation are balanced using prior quality, uncertainty, information value, risk and reversibility.

Before optimizing any metric, define population, denominator, validity, confounders, guardrails and stopping rules.

Calibration is itself evidence.
