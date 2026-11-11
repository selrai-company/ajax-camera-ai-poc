# Run 1: 8 evenly spaced frames, first prompt (before fixes)

```
Evaluation: Ridgeview Apartments, Stage 2 (demo)  (0.079 h of labelled footage)

camera    held out      gate   flagged  false  AI person    cost $
gate_road              4/4       1/2       0      3/4      0.0032
yard                   2/2       2/2       0      2/2      0.0027
site_office             1/1       1/1       0      1/1      0.0015
lunch_roomyes          1/1       1/1       0      1/1      0.0011
street                 1/1       0/0       0      1/1      0.0015
back_fence             0/0       0/0       0      0/0      0.0013
laneway                0/0       0/0       0      0/0      0.0010
flood_pole             0/0       0/0       0      0/0      0.0013

Gate recall (person/vehicle events caught by motion gate): 100%
End-to-end recall (should-flag events marked 'needs a look'): 83%
AI person present/absent accuracy on gated events: 89%
False 'needs a look' flags per hour of footage: 0.0
Estimated API cost per camera-hour: $0.1725

Evaluation: Hillcrest Civil depot, weekend shutdown (demo)  (0.04 h of labelled footage)

camera    held out      gate   flagged  false  AI person    cost $
gate_road              4/4       1/2       0      3/4      0.0031
yard                   2/2       2/2       0      2/2      0.0011
site_office             1/1       1/1       0      1/1      0.0017
lunch_roomyes          1/1       1/1       0      1/1      0.0142
street                 1/1       0/0       0      1/1      0.0017

Gate recall (person/vehicle events caught by motion gate): 100%
End-to-end recall (should-flag events marked 'needs a look'): 83%
AI person present/absent accuracy on gated events: 89%
False 'needs a look' flags per hour of footage: 0.0
Estimated API cost per camera-hour: $0.5447
```

Cost figures in this run used the CLI's multi-turn token counters (over-counted, see run 2).
