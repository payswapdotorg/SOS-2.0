# SOS 2.0 Productization Roadmap

STATUS: POST-W18 IMPLEMENTATION PROGRAM

W0-W18 is complete and frozen. This roadmap productizes the proven core.

P0 Productization contracts + UX simulation
  |
  +----------------------+----------------------+
  |                      |                      |
 P1 Web shell          P2 Live data/API       P3 Deployment
  |                      |                      |
  +-----------+----------+----------+-----------+
              |                     |
             P4                    P5
        Onboarding          Evidence/reality
              \                     /
               \                   /
                    P6
          Candidate/assurance/
          experiment/ASK
                    |
            +-------+-------+
            |       |       |
           P7      P8      P9
        Package/  Actions  Production
        history/  + auth   hardening
        evolution
            \       |      /
             \      |     /
                    P10
              UX dogfood,
              accessibility,
              deployment rehearsal
                    |
                   P11
              Product release gate

First dispatch after P0:
Worker A -> P1
Worker B -> P2
Worker C -> P3

Second:
Worker A -> P4
Worker B -> P5
Worker C -> P6

Third:
Worker A -> P7
Worker B -> P8
Worker C -> P9

Final:
all workers -> P10
Architect -> P11

Rules:
- apps/console remains deterministic reference harness
- apps/web is the production user-facing surface
- UI consumes domain/view-model contracts
- production state never comes from demo fixtures
- providers remain adapters
