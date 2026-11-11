# Run 3: after the independent review fixes

Same prompt and sampling as run 2, plus these fixes:

- Burned-in camera clocks are blacked out in the frames sent to Haiku. Run 2 sometimes quoted the camera's wrong clock time (e.g. '05:38 PM' for a 01:52 event); after this, no stored description mentions a clock time or a gendered word.
- Whole-frame changes of 2 s or more get an AI look.
- 'Not a problem' can only drop an armed person to FYI, never hide them.
- Gate-only reruns keep AI reports, and events are keyed on wall-clock time.
- Scoring shows events per camera and splits person-present from person-absent, with cant_tell counted as wrong.

An intermediate full re-run with no cache (before the clock blackout) gave the same scores as run 2.

## Read these numbers with care

- **Not two sites.** Hillcrest is the same five scenes as Ridgeview with the original daylight footage
  and identical labels. In total there are about 8 distinct scenes, not 16 independent events.
- **No real night footage with people.** Every "night" person is darkened daytime footage (`simnight_`).
  The three real night clips (IR coyotes, fox, snow) contain no people, so person detection on real
  infrared is untested.
- **Labels were written by the build agent**, from 1-second contact sheets, not by a person. They
  went into the same commit as the code (`3c75d0f`), so "labelled before any model run" is a
  statement, not something you can check from the history.
- **Tuned on the test clips.** Between run 1 and run 2 the frame sampling, the prompt and the gate's
  close-up crop all changed after seeing run 1 on these same clips. Only `lunch_room` is held out,
  and only from gate tuning.
- **Recall is generous by construction.** Any overlap counts, so one long event can cover several
  labels (Hillcrest yard: one event covers both walk-pasts). On short clips that are mostly
  activity, gate recall is close to 100% almost automatically. Compare `events` with the label counts.
- **Runs aren't directly comparable.** Run 1 scored AI accuracy per label; later runs score per event
  and split person-present from person-absent. The person-absent cases (animals, snow, a truck) are
  easy.

What this does show: the whole chain works end to end on varied footage. The AI descriptions are
specific and stay inside the privacy rules. Severity comes out right on these scenes, and the cost per
described event is about a tenth of a cent. Re-run `camai eval` on labelled real Ajax nights before
quoting any accuracy figure.

```
Evaluation: Ridgeview Apartments, Stage 2 (demo)  (0.079 h of labelled footage)

camera       held out  events    gated  flagged  false  person yes  person no   cost $
gate_road                   2     4/4      2/2       0        2/2        0/0    0.0027
yard                        2     2/2      2/2       0        2/2        0/0    0.0022
site_office                 1     1/1      1/1       0        1/1        0/0    0.0014
lunch_room   yes            1     1/1      1/1       0        1/1        0/0    0.0016
street                      1     1/1      0/0       0        0/0        1/1    0.0011
back_fence                  1     0/0      0/0       0        0/0        1/1    0.0010
laneway                     1     0/0      0/0       0        0/0        1/1    0.0011
flood_pole                  1     0/0      0/0       0        0/0        1/1    0.0010

Gate recall (labelled person/vehicle events overlapped by a gate event): 100% (9/9)
End-to-end recall (should-flag labels overlapped by a 'needs a look' event): 100% (6/6)
AI said 'person' when a person was there: 100% (6/6)
AI said 'no person' when none was there (cant_tell counts as wrong): 100% (4/4)
False 'needs a look' flags per hour of footage: 0.0
Estimated API cost per described event: $0.00122
Estimated API cost per camera-hour: $0.1544 (stand-in clips are wall-to-wall events, so this is far above a real quiet night)

Recall counts any overlap, so one long event can cover several labels. On short clips that are
mostly activity, gate recall is close to 100% by construction; compare 'events' with the label counts.

Evaluation: Hillcrest Civil depot, weekend shutdown (demo)  (0.04 h of labelled footage)

camera       held out  events    gated  flagged  false  person yes  person no   cost $
gate_road                   2     4/4      2/2       0        2/2        0/0    0.0024
yard                        1     2/2      2/2       0        1/1        0/0    0.0013
site_office                 1     1/1      1/1       0        1/1        0/0    0.0011
lunch_room   yes            1     1/1      1/1       0        1/1        0/0    0.0013
street                      1     1/1      0/0       0        0/0        0/1    0.0011

Gate recall (labelled person/vehicle events overlapped by a gate event): 100% (9/9)
End-to-end recall (should-flag labels overlapped by a 'needs a look' event): 100% (6/6)
AI said 'person' when a person was there: 100% (5/5)
AI said 'no person' when none was there (cant_tell counts as wrong): 0% (0/1)
False 'needs a look' flags per hour of footage: 0.0
Estimated API cost per described event: $0.0012
Estimated API cost per camera-hour: $0.1805 (stand-in clips are wall-to-wall events, so this is far above a real quiet night)

Recall counts any overlap, so one long event can cover several labels. On short clips that are
mostly activity, gate recall is close to 100% by construction; compare 'events' with the label counts.
```

**Run-to-run variation:** on Hillcrest `street` (daytime delivery truck) this run said `cant_tell` for "person
present" ("whether any person was on or near the truck"), where the previous run said `no`. Under the stricter
scoring that counts as wrong. Severity was unaffected: a vehicle seen while armed is "For your info" either way.
