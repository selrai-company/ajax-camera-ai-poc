# Hand labels (ground truth)

One file per camera: `labels/<site_id>/<camera_id>.json`. Write labels **before** running
any model on that footage, and commit them first, so results can't shape the labels.

```json
{
  "camera_id": "cam1",
  "held_out": false,
  "labelled_by": "initials",
  "events": [
    {"start": 12.0, "end": 31.5, "what": "person", "should_flag": true, "note": "walks from gate to container"},
    {"start": 40.0, "end": 44.0, "what": "vehicle", "should_flag": false, "note": "car passes on street"},
    {"start": 60.0, "end": 75.0, "what": "nuisance", "should_flag": false, "note": "tree moving in wind"}
  ]
}
```

- `what`: `person`, `vehicle`, `animal` or `nuisance` (rain, trees, lights, insects).
- `should_flag`: would a site manager want this in "Needs a look" if it happened while armed?
- `held_out: true` marks clips never used to tune thresholds. Report them separately.
- Times are seconds from the start of the file.

`camai eval sites/<site>.yaml` scores the motion gate and the AI separately.
