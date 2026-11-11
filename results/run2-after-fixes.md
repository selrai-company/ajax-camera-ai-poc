# Run 2: adaptive frame sampling + prompt fixes

Changes after run 1: one frame every ~2.5 s (6-16 frames) instead of a fixed 8; the gate's close-up crop now centres on the
largest moving blob; prompt forbids gendered words and
burned-in camera timestamps; AI accuracy now scored per event (run 1 scored per label, which penalised correct
answers on events containing both a person and a vehicle); subscription-mode input tokens estimated from what was sent.

See `run3-after-review.md` for the full caveats (repeated scenes, simulated night, agent-written labels, generous recall).

**Caveat:** these fixes were made after seeing run 1 on the same clips, so this is tuned, not held-out, performance.
Only lunch_room is held out from gate tuning. 16 events in total is far too few to claim accuracy; the point is that
the harness works. Re-run on real Ajax footage before quoting any number.

```
Evaluation: Ridgeview Apartments, Stage 2 (demo)  (0.079 h of labelled footage)

camera       held out      gate   flagged  false  AI person    cost $
gate_road                 4/4       2/2       0      2/2      0.0024
yard                      2/2       2/2       0      2/2      0.0018
site_office               1/1       1/1       0      1/1      0.0011
lunch_room   yes          1/1       1/1       0      1/1      0.0009
street                    1/1       0/0       0      1/1      0.0011
back_fence                0/0       0/0       0      1/1      0.0012
laneway                   0/0       0/0       0      1/1      0.0011
flood_pole                0/0       0/0       0      1/1      0.0011

Gate recall (person/vehicle events caught by motion gate): 100%
End-to-end recall (should-flag events marked 'needs a look'): 100%
AI person present/absent accuracy, per event: 100%
False 'needs a look' flags per hour of footage: 0.0
Estimated API cost per described event (Haiku): $0.00107
Estimated API cost per camera-hour: $0.1353 (stand-in clips are wall-to-wall events, so this is far above a real quiet night)

Evaluation: Hillcrest Civil depot, weekend shutdown (demo)  (0.04 h of labelled footage)

camera       held out      gate   flagged  false  AI person    cost $
gate_road                 4/4       2/2       0      2/2      0.0027
yard                      2/2       2/2       0      1/1      0.0014
site_office               1/1       1/1       0      1/1      0.0012
lunch_room   yes          1/1       1/1       0      1/1      0.0013
street                    1/1       0/0       0      1/1      0.0011

Gate recall (person/vehicle events caught by motion gate): 100%
End-to-end recall (should-flag events marked 'needs a look'): 100%
AI person present/absent accuracy, per event: 100%
False 'needs a look' flags per hour of footage: 0.0
Estimated API cost per described event (Haiku): $0.00127
Estimated API cost per camera-hour: $0.1898 (stand-in clips are wall-to-wall events, so this is far above a real quiet night)
```
