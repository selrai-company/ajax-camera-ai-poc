# Stand-in footage credits

The demo uses freely licensed clips from Wikimedia Commons, cut into single-camera segments
by `scripts/prepare_footage_v1.py`. Video files are not committed; run the script to fetch them.
`simnight_` segments are the daytime clips darkened and greyscaled to imitate night infrared.

| Segments | Original | Creator | Licence |
|---|---|---|---|
| night_snow | [Snow under LED street light in Tuntorp, Brastad](https://commons.wikimedia.org/wiki/File:Snow_under_LED_street_light_in_Tuntorp,_Brastad.webm) | W.carter | CC BY 4.0 |
| night_fox_alley | [Urban fox at night](https://commons.wikimedia.org/wiki/File:Urban_fox_at_night.webm) | Domdomegg | CC BY 4.0 |
| night_ir_coyotes | [Coyote Scent Marking, Feb. 2022](https://commons.wikimedia.org/wiki/File:Coyote_Scent_Marking,_Feb._2022.webm) | Cabin Branch Wildlife | CC BY 3.0 |
| day/simnight_street_truck, day/simnight_street_pickup | [Porch Pirates](https://commons.wikimedia.org/wiki/File:Porch_Pirates.ogv) | nayrproductions | CC BY 3.0 |
| day/simnight_driveway_walker, day/simnight_porch_parcel | [Package Theft from home](https://commons.wikimedia.org/wiki/File:Package_Theft_from_home.ogv) | DonGar37 | CC BY 3.0 |
| day/simnight_porch_backpack | [Don't Tempt a Thief with Unattended Parcels](https://commons.wikimedia.org/wiki/File:Don%27t_Tempt_a_Thief_with_Unattended_Parcels.ogv) | vpdonline (Vancouver Police Department) | CC BY 3.0 |

Segments are trimmed, rescaled and (for simnight) colour-graded. These are modifications of the originals.

## Job-site footage (demo sites Ridgeview and Hillcrest)

Prepared by `scripts/prepare_jobsite_footage.py` (downloads the originals, then trims, crops and
re-encodes them). `pole_cam_covered` is generated (grey with noise) to stand in for a taped-over lens.

| Segment | Original | Creator | Licence |
|---|---|---|---|
| yard_theft, yard_idle | [Florida Man Arrested for Attempting to Steal a Septic Tank](https://commons.wikimedia.org/wiki/File:Florida_Man_Arrested_for_Attempting_to_Steal_a_Septic_Tank.webm) (real CCTV, captions/logo cropped, clock blurred) | Marion County Sheriff's Office | Public domain |
| gate_lockpick, gate_idle | [Mugger opening the lock at night](https://mixkit.co/free-stock-video/mugger-opening-the-lock-at-night-31380/) (staged) | Mixkit | Mixkit Free License |
| tamper_watch | [A man covering CCTV camera with a tape](https://www.pexels.com/video/a-man-covering-cctv-camera-with-a-tape-6258198/) (staged) | RDNE Stock project | Pexels License |
| fog_walker | [Man walking with flashlight at night](https://www.pexels.com/video/man-walking-with-flashlight-at-night-11839732/) | Sergei Skrynnik | Pexels License |
| torch_track | [A man walking on a road at night with a flashlight](https://www.pexels.com/video/a-man-walking-on-a-road-at-night-with-a-flashlight-19405094/) | Orhan Pergel | Pexels License |
| headtorches | [Men with flashlights standing outdoors at night](https://www.pexels.com/video/men-with-flashlights-standing-outdoors-at-night-6831476/) | Tima Miroshnichenko | Pexels License |
| street_van | [Empty city street at night with construction](https://www.pexels.com/video/empty-city-street-at-night-with-construction-39644096/) | Altaf Shah | Pexels License |
| night_pour | [Night construction site with busy highway](https://www.pexels.com/video/night-construction-site-with-busy-highway-35039490/) | SAI GON CO PHAN SAN XUAT - THUONG MAI | Pexels License |
| pump_trucks | [Nighttime road construction with cement truck](https://www.pexels.com/video/nighttime-road-construction-with-cement-truck-35039487/) | SAI GON CO PHAN SAN XUAT - THUONG MAI | Pexels License |
| delivery_flatbed | [Urban construction scene with workers in safety gear](https://www.pexels.com/video/urban-construction-scene-with-workers-in-safety-gear-38885275/) | Kiwi and Camera | Pexels License |
| excavator_day | [Urban construction workers in Auckland city](https://www.pexels.com/video/urban-construction-workers-in-auckland-city-38885267/) | Kiwi and Camera | Pexels License |
| laneway_hoarding | [An empty dark alley](https://www.pexels.com/video/an-empty-dark-alley-7084482/) | Lachlan Ross | Pexels License |
| truck_yard | [Nighttime industrial complex with cloud movement](https://www.pexels.com/video/nighttime-industrial-complex-with-cloud-movement-40197518/) | Messiedo Xadinho | Pexels License |
| earthworks_night | [Nighttime construction site with excavator](https://www.pexels.com/video/nighttime-construction-site-with-excavator-34196525/) | Constantino Filmes | Pexels License |
| guard_post | [Security guard whistling outdoors](https://www.pexels.com/video/security-guard-whistling-outdoors-29629758/) | aksinfo7 universe | Pexels License |

The demo also reuses three night clips from the first stand-in set (fox, coyotes, snow) and
places the street-van clip on two nights to demonstrate repeat-vehicle detection.
