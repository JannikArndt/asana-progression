### Suggestions, replayed top to bottom (other sessions as history)

| Session | Holds | Top 1 | Top 3 |
|---|---|---|---|
| S1 | 93 | 87 (94 %) | 91 (98 %) |
| S2 | 56 | 45 (80 %) | 51 (91 %) |
| S3 | 95 | 89 (94 %) | 92 (97 %) |
| All | 244 | 221 (91 %) | 234 (96 %) |

Not the top suggestion, by cause:

| Cause | S1 | S2 | S3 | All |
|---|---|---|---|---|
| fewer reps than usual | 1 | 1 | 1 | 3 |
| new video (break) | 0 | 3 | 0 | 3 |
| new video (break) (not in top 3) | 0 | 2 | 1 | 3 |
| other order (not in top 3) | 1 | 2 | 1 | 4 |
| skipped entries | 3 | 2 | 2 | 7 |
| skipped entries (not in top 3) | 1 | 1 | 1 | 3 |

### Pose classifier on the stills (world landmarks, leave one session out; 236 holds with a pose)

| Class distance | Angle weight | Asana top 1 | Asana top 3 | Family | Letter, family right (n) | Side, asana given (n) | Asana top 1 per held-out session |
|---|---|---|---|---|---|---|---|
| nearest sample | 0 | 58 % | 80 % | 67 % | 75 % (77) | 77 % (106) | S1 60 %, S2 63 %, S3 54 % |
| nearest sample | 0.5 | 61 % | 79 % | 68 % | 78 % (79) | 77 % (106) | S1 60 %, S2 71 %, S3 56 % |
| nearest sample | 1 | 58 % | 79 % | 66 % | 78 % (76) | 75 % (106) | S1 60 %, S2 67 %, S3 52 % |
| nearest sample | 2 | 56 % | 81 % | 62 % | 80 % (69) | 74 % (106) | S1 59 %, S2 63 %, S3 49 % |
| mean of 2 nearest | 0 | 60 % | 77 % | 67 % | 77 % (73) | 75 % (106) | S1 63 %, S2 63 %, S3 56 % |
| mean of 2 nearest | 0.5 | 61 % | 79 % | 69 % | 77 % (73) | 76 % (106) | S1 63 %, S2 62 %, S3 60 % |
| mean of 2 nearest | 1 | 57 % | 78 % | 66 % | 71 % (70) | 75 % (106) | S1 59 %, S2 58 %, S3 55 % |
| mean of 2 nearest | 2 | 56 % | 78 % | 62 % | 77 % (66) | 75 % (106) | S1 55 %, S2 58 %, S3 55 % |

Most frequent confusions (best setting):

| Truth → predicted | Count |
|---|---|
| Janu Sirsasana B → Tiryang Mukha Eka Pada Paschimottanasana | 5 |
| Janu Sirsasana C → Tiryang Mukha Eka Pada Paschimottanasana | 5 |
| Janu Sirsasana A → Tiryang Mukha Eka Pada Paschimottanasana | 4 |
| Utthita Hasta Padangusthasana A → Utthita Hasta Padangusthasana C | 3 |
| Padangusthasana → Ardha Baddha Padmottanasana | 2 |
| Parivrtta Parsvakonasana → Parivrtta Trikonasana | 2 |
| Paschimottanasana C → Tiryang Mukha Eka Pada Paschimottanasana | 2 |
| Ardha Baddha Padma Paschimottanasana → Paschimottanasana A | 2 |
| Utthita Hasta Padangusthasana B → Utthita Hasta Padangusthasana C | 2 |
| Paschimottanasana B → Tiryang Mukha Eka Pada Paschimottanasana | 2 |
| Parsvottanasana → Ardha Baddha Padmottanasana | 2 |
| Supta Padangusthasana B → Supta Padangusthasana A | 2 |
| Padahastasana → Padangusthasana | 1 |
| Parivrtta Trikonasana → Utthita Trikonasana | 1 |
| Parivrtta Parsvakonasana → Utthita Trikonasana | 1 |

### Zero-touch naming: every hold takes its first suggestion, nothing corrected (asana and side)

| Method | S1 | S2 | S3 | All |
|---|---|---|---|---|
| Suggestions today (greedy template order) | 10 % | 0 % | 14 % | 9 % |
| Alignment, no pose | 10 % | 0 % | 14 % | 9 % |
| Pose only (nearest sample) | 52 % | 59 % | 54 % | 54 % |
| Alignment + pose (weight 2) | 88 % | 88 % | 91 % | 89 % |
| Alignment + pose (weight 5) | 87 % | 88 % | 86 % | 87 % |
| Alignment + pose (weight 10) | 85 % | 77 % | 85 % | 83 % |
| Alignment + pose (weight 20) | 72 % | 77 % | 81 % | 77 % |

### Top-to-bottom review: suggestions today vs alignment + pose

| Method (top 1 / top 3) | S1 | S2 | S3 | All |
|---|---|---|---|---|
| Suggestions today | 94 % / 98 % | 80 % / 91 % | 94 % / 97 % | 91 % / 96 % |
| Suggestions today + posture class of the still | 95 % / 98 % | 82 % / 91 % | 94 % / 97 % | 91 % / 96 % |
| Alignment + pose (weight 2) | 91 % / 98 % | 88 % / 98 % | 92 % / 97 % | 91 % / 98 % |
| Alignment + pose (weight 5) | 90 % / 97 % | 89 % / 98 % | 89 % / 96 % | 90 % / 97 % |
| Alignment, no pose | 91 % / 97 % | 77 % / 91 % | 92 % / 96 % | 88 % / 95 % |

### Zero-touch on the detector's candidates (defaults; right = the label of the hold it belongs to, or "no hold" for a false detection)

| Method | S1 | S2 | S3 | All |
|---|---|---|---|---|
| Suggestions today (greedy) | 10/108 (9 %) | 0/53 (0 %) | 29/97 (30 %) | 15 % |
| Alignment + pose, "no hold" cost 1 | 59/108 (55 %) | 40/53 (75 %) | 55/97 (57 %) | 60 % |
| Alignment + pose, "no hold" cost 2 | 62/108 (57 %) | 35/53 (66 %) | 66/97 (68 %) | 63 % |
| Alignment + pose, "no hold" cost 3 | 64/108 (59 %) | 35/53 (66 %) | 74/97 (76 %) | 67 % |

#### S1: every hold, suggestions today

| # | Truth | Rank | Top 3 | Cause |
|---|---|---|---|---|
| 1 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 2 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 3 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 4 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 5 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 6 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 7 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 8 | Padangusthasana | 2 | Adho Mukha Svanasana · Padangusthasana · Padahastasana | fewer reps than usual |
| 9 | Padahastasana | 1 | Padahastasana · Utthita Trikonasana R · Utthita Trikonasana L |  |
| 10 | Utthita Trikonasana R | 1 | Utthita Trikonasana R · Utthita Trikonasana L · Parivrtta Trikonasana R |  |
| 11 | Utthita Trikonasana L | 1 | Utthita Trikonasana L · Parivrtta Trikonasana R · Parivrtta Trikonasana L |  |
| 12 | Parivrtta Trikonasana R | 1 | Parivrtta Trikonasana R · Parivrtta Trikonasana L · Utthita Parsvakonasana R |  |
| 13 | Parivrtta Trikonasana L | 1 | Parivrtta Trikonasana L · Utthita Parsvakonasana R · Utthita Parsvakonasana L |  |
| 14 | Utthita Parsvakonasana R | 1 | Utthita Parsvakonasana R · Utthita Parsvakonasana L · Parivrtta Parsvakonasana R |  |
| 15 | Utthita Parsvakonasana L | 1 | Utthita Parsvakonasana L · Parivrtta Parsvakonasana R · Parivrtta Parsvakonasana L |  |
| 16 | Parivrtta Parsvakonasana R | 1 | Parivrtta Parsvakonasana R · Parivrtta Parsvakonasana L · Prasarita Padottanasana A |  |
| 17 | Parivrtta Parsvakonasana L | 1 | Parivrtta Parsvakonasana L · Prasarita Padottanasana A · Prasarita Padottanasana B |  |
| 18 | Prasarita Padottanasana A | 1 | Prasarita Padottanasana A · Prasarita Padottanasana B · Prasarita Padottanasana C |  |
| 19 | Prasarita Padottanasana B | 1 | Prasarita Padottanasana B · Prasarita Padottanasana C · Prasarita Padottanasana D |  |
| 20 | Prasarita Padottanasana C | 1 | Prasarita Padottanasana C · Prasarita Padottanasana D · Parsvottanasana R |  |
| 21 | Prasarita Padottanasana D | 1 | Prasarita Padottanasana D · Parsvottanasana R · Parsvottanasana L |  |
| 22 | Ardha Baddha Padmottanasana R | – | Parsvottanasana R · Parsvottanasana L · Utthita Hasta Padangusthasana A R | skipped entries |
| 23 | Ardha Baddha Padmottanasana L | 1 | Ardha Baddha Padmottanasana L · Utkatasana · Virabhadrasana A R |  |
| 24 | Utthita Hasta Padangusthasana A R | – | Utkatasana · Virabhadrasana A R · Virabhadrasana A L | other order |
| 25 | Utthita Hasta Padangusthasana B R | 1 | Utthita Hasta Padangusthasana B R · Utthita Hasta Padangusthasana C R · Utthita Hasta Padangusthasana A L |  |
| 26 | Utthita Hasta Padangusthasana C R | 1 | Utthita Hasta Padangusthasana C R · Utthita Hasta Padangusthasana A L · Utthita Hasta Padangusthasana B L |  |
| 27 | Utthita Hasta Padangusthasana A L | 1 | Utthita Hasta Padangusthasana A L · Utthita Hasta Padangusthasana B L · Utthita Hasta Padangusthasana C L |  |
| 28 | Utthita Hasta Padangusthasana B L | 1 | Utthita Hasta Padangusthasana B L · Utthita Hasta Padangusthasana C L · Utkatasana |  |
| 29 | Utthita Hasta Padangusthasana C L | 1 | Utthita Hasta Padangusthasana C L · Utkatasana · Virabhadrasana A R |  |
| 30 | Utkatasana | 1 | Utkatasana · Virabhadrasana A R · Virabhadrasana A L |  |
| 31 | Virabhadrasana A R | 1 | Virabhadrasana A R · Virabhadrasana A L · Virabhadrasana B R |  |
| 32 | Virabhadrasana A L | 1 | Virabhadrasana A L · Virabhadrasana B R · Virabhadrasana B L |  |
| 33 | Virabhadrasana B R | 1 | Virabhadrasana B R · Virabhadrasana B L · Dandasana |  |
| 34 | Virabhadrasana B L | 1 | Virabhadrasana B L · Dandasana · Paschimottanasana A |  |
| 35 | Dandasana | 1 | Dandasana · Paschimottanasana A · Paschimottanasana B |  |
| 36 | Paschimottanasana A | 1 | Paschimottanasana A · Paschimottanasana B · Paschimottanasana C |  |
| 37 | Paschimottanasana B | 1 | Paschimottanasana B · Paschimottanasana C · Purvottanasana |  |
| 38 | Paschimottanasana C | 1 | Paschimottanasana C · Purvottanasana · Ardha Baddha Padma Paschimottanasana R |  |
| 39 | Purvottanasana | 1 | Purvottanasana · Ardha Baddha Padma Paschimottanasana R · Ardha Baddha Padma Paschimottanasana L |  |
| 40 | Ardha Baddha Padma Paschimottanasana R | 1 | Ardha Baddha Padma Paschimottanasana R · Ardha Baddha Padma Paschimottanasana L · Tiryang Mukha Eka Pada Paschimottanasana R |  |
| 41 | Ardha Baddha Padma Paschimottanasana L | 1 | Ardha Baddha Padma Paschimottanasana L · Tiryang Mukha Eka Pada Paschimottanasana R · Tiryang Mukha Eka Pada Paschimottanasana L |  |
| 42 | Tiryang Mukha Eka Pada Paschimottanasana R | 1 | Tiryang Mukha Eka Pada Paschimottanasana R · Tiryang Mukha Eka Pada Paschimottanasana L · Janu Sirsasana A R |  |
| 43 | Tiryang Mukha Eka Pada Paschimottanasana L | 1 | Tiryang Mukha Eka Pada Paschimottanasana L · Janu Sirsasana A R · Janu Sirsasana A L |  |
| 44 | Janu Sirsasana A R | 1 | Janu Sirsasana A R · Janu Sirsasana A L · Janu Sirsasana B R |  |
| 45 | Janu Sirsasana A L | 1 | Janu Sirsasana A L · Janu Sirsasana B R · Janu Sirsasana B L |  |
| 46 | Janu Sirsasana B R | 1 | Janu Sirsasana B R · Janu Sirsasana B L · Janu Sirsasana C R |  |
| 47 | Janu Sirsasana B L | 1 | Janu Sirsasana B L · Janu Sirsasana C R · Janu Sirsasana C L |  |
| 48 | Janu Sirsasana C R | 1 | Janu Sirsasana C R · Janu Sirsasana C L · Marichyasana A R |  |
| 49 | Janu Sirsasana C L | 1 | Janu Sirsasana C L · Marichyasana A R · Marichyasana A L |  |
| 50 | Marichyasana A R | 1 | Marichyasana A R · Marichyasana A L · Marichyasana B R |  |
| 51 | Marichyasana A L | 1 | Marichyasana A L · Marichyasana B R · Marichyasana B L |  |
| 52 | Marichyasana B R | 1 | Marichyasana B R · Marichyasana B L · Marichyasana C R |  |
| 53 | Marichyasana B L | 1 | Marichyasana B L · Marichyasana C R · Marichyasana C L |  |
| 54 | Marichyasana C R | 1 | Marichyasana C R · Marichyasana C L · Marichyasana D R |  |
| 55 | Marichyasana C L | 1 | Marichyasana C L · Marichyasana D R · Marichyasana D L |  |
| 56 | Marichyasana D R | 1 | Marichyasana D R · Marichyasana D L · Navasana |  |
| 57 | Marichyasana D L | 1 | Marichyasana D L · Navasana · Bhujapidasana |  |
| 58 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 59 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 60 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 61 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 62 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 63 | Bhujapidasana | 1 | Bhujapidasana · Navasana · Kurmasana |  |
| 64 | Kurmasana | 1 | Kurmasana · Supta Kurmasana · Garbha Pindasana |  |
| 65 | Supta Kurmasana | 1 | Supta Kurmasana · Garbha Pindasana · Kukkutasana |  |
| 66 | Garbha Pindasana | 1 | Garbha Pindasana · Kukkutasana · Baddha Konasana A |  |
| 67 | Kukkutasana | 1 | Kukkutasana · Baddha Konasana A · Baddha Konasana B |  |
| 68 | Baddha Konasana A | 1 | Baddha Konasana A · Baddha Konasana B · Upavistha Konasana A |  |
| 69 | Baddha Konasana B | 1 | Baddha Konasana B · Upavistha Konasana A · Upavistha Konasana B |  |
| 70 | Upavistha Konasana A | 1 | Upavistha Konasana A · Upavistha Konasana B · Supta Konasana |  |
| 71 | Upavistha Konasana B | 1 | Upavistha Konasana B · Supta Konasana · Supta Padangusthasana A R |  |
| 72 | Supta Konasana | 1 | Supta Konasana · Supta Padangusthasana A R · Supta Padangusthasana B R |  |
| 73 | Supta Padangusthasana A R | 1 | Supta Padangusthasana A R · Supta Padangusthasana B R · Supta Padangusthasana A L |  |
| 74 | Supta Padangusthasana B R | 1 | Supta Padangusthasana B R · Supta Padangusthasana A L · Supta Padangusthasana B L |  |
| 75 | Supta Padangusthasana A L | 1 | Supta Padangusthasana A L · Supta Padangusthasana B L · Ubhaya Padangusthasana |  |
| 76 | Ubhaya Padangusthasana | 2 | Supta Padangusthasana B L · Ubhaya Padangusthasana · Urdhva Mukha Paschimottanasana | skipped entries |
| 77 | Setu Bandhasana | 2 | Urdhva Mukha Paschimottanasana · Setu Bandhasana · Urdhva Dhanurasana | skipped entries |
| 78 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 79 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 80 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 81 | Paschimottanasana A | 1 | Paschimottanasana A · Urdhva Dhanurasana · Salamba Sarvangasana |  |
| 82 | Salamba Sarvangasana | 1 | Salamba Sarvangasana · Halasana · Karnapidasana |  |
| 83 | Halasana | 1 | Halasana · Karnapidasana · Urdhva Padmasana |  |
| 84 | Karnapidasana | 1 | Karnapidasana · Urdhva Padmasana · Pindasana |  |
| 85 | Urdhva Padmasana | 1 | Urdhva Padmasana · Pindasana · Matsyasana |  |
| 86 | Pindasana | 1 | Pindasana · Matsyasana · Uttana Padasana |  |
| 87 | Matsyasana | 1 | Matsyasana · Uttana Padasana · Sirsasana A |  |
| 88 | Sirsasana A | 2 | Uttana Padasana · Sirsasana A · Sirsasana B | skipped entries |
| 89 | Sirsasana B | 1 | Sirsasana B · Balasana · Yoga Mudra |  |
| 90 | Balasana | 1 | Balasana · Yoga Mudra · Padmasana |  |
| 91 | Yoga Mudra | 1 | Yoga Mudra · Padmasana · Utpluthih |  |
| 92 | Padmasana | 1 | Padmasana · Utpluthih · Savasana |  |
| 93 | Utpluthih | 1 | Utpluthih · Savasana |  |

#### S2: every hold, suggestions today

| # | Truth | Rank | Top 3 | Cause |
|---|---|---|---|---|
| 1 | Utthita Hasta Padangusthasana A R | – | Adho Mukha Svanasana · Padangusthasana · Padahastasana | skipped entries |
| 2 | Utthita Hasta Padangusthasana B R | 1 | Utthita Hasta Padangusthasana B R · Utthita Hasta Padangusthasana C R · Utthita Hasta Padangusthasana A L |  |
| 3 | Utthita Hasta Padangusthasana C R | 1 | Utthita Hasta Padangusthasana C R · Utthita Hasta Padangusthasana A L · Utthita Hasta Padangusthasana B L |  |
| 4 | Utthita Hasta Padangusthasana B L | 2 | Utthita Hasta Padangusthasana A L · Utthita Hasta Padangusthasana B L · Utthita Hasta Padangusthasana C L | skipped entries |
| 5 | Utthita Hasta Padangusthasana A L | – | Utthita Hasta Padangusthasana C L · Ardha Baddha Padmottanasana R · Ardha Baddha Padmottanasana L | other order |
| 6 | Utthita Hasta Padangusthasana C L | 1 | Utthita Hasta Padangusthasana C L · Ardha Baddha Padmottanasana R · Ardha Baddha Padmottanasana L |  |
| 7 | Ardha Baddha Padmottanasana R | 1 | Ardha Baddha Padmottanasana R · Ardha Baddha Padmottanasana L · Utkatasana |  |
| 8 | Ardha Baddha Padmottanasana L | 1 | Ardha Baddha Padmottanasana L · Utkatasana · Virabhadrasana A R |  |
| 9 | Utkatasana | 1 | Utkatasana · Virabhadrasana A R · Virabhadrasana A L |  |
| 10 | Virabhadrasana A R | 1 | Virabhadrasana A R · Virabhadrasana A L · Virabhadrasana B R |  |
| 11 | Virabhadrasana A L | 1 | Virabhadrasana A L · Virabhadrasana B R · Virabhadrasana B L |  |
| 12 | Virabhadrasana B R | 1 | Virabhadrasana B R · Virabhadrasana B L · Dandasana |  |
| 13 | Virabhadrasana B L | 1 | Virabhadrasana B L · Dandasana · Paschimottanasana A |  |
| 14 | Paschimottanasana A | 2 | Dandasana · Paschimottanasana A · Paschimottanasana B | skipped entries |
| 15 | Dandasana | – | Paschimottanasana B · Paschimottanasana C · Purvottanasana | other order |
| 16 | Paschimottanasana B | 1 | Paschimottanasana B · Paschimottanasana C · Purvottanasana |  |
| 17 | Paschimottanasana C | 1 | Paschimottanasana C · Purvottanasana · Ardha Baddha Padma Paschimottanasana R |  |
| 18 | Purvottanasana | 1 | Purvottanasana · Ardha Baddha Padma Paschimottanasana R · Ardha Baddha Padma Paschimottanasana L |  |
| 19 | Ardha Baddha Padma Paschimottanasana R | 1 | Ardha Baddha Padma Paschimottanasana R · Ardha Baddha Padma Paschimottanasana L · Tiryang Mukha Eka Pada Paschimottanasana R |  |
| 20 | Ardha Baddha Padma Paschimottanasana L | 1 | Ardha Baddha Padma Paschimottanasana L · Tiryang Mukha Eka Pada Paschimottanasana R · Tiryang Mukha Eka Pada Paschimottanasana L |  |
| 21 | Tiryang Mukha Eka Pada Paschimottanasana R | 1 | Tiryang Mukha Eka Pada Paschimottanasana R · Tiryang Mukha Eka Pada Paschimottanasana L · Janu Sirsasana A R |  |
| 22 | Tiryang Mukha Eka Pada Paschimottanasana L | 1 | Tiryang Mukha Eka Pada Paschimottanasana L · Janu Sirsasana A R · Janu Sirsasana A L |  |
| 23 | Janu Sirsasana A R | 1 | Janu Sirsasana A R · Janu Sirsasana A L · Janu Sirsasana B R |  |
| 24 | Janu Sirsasana A L | 1 | Janu Sirsasana A L · Janu Sirsasana B R · Janu Sirsasana B L |  |
| 25 | Janu Sirsasana B R | 1 | Janu Sirsasana B R · Janu Sirsasana B L · Janu Sirsasana C R |  |
| 26 | Janu Sirsasana B L | 1 | Janu Sirsasana B L · Janu Sirsasana C R · Janu Sirsasana C L |  |
| 27 | Janu Sirsasana C R | 1 | Janu Sirsasana C R · Janu Sirsasana C L · Marichyasana A R |  |
| 28 | Janu Sirsasana C L | 1 | Janu Sirsasana C L · Marichyasana A R · Marichyasana A L |  |
| 29 | Marichyasana A R | 1 | Marichyasana A R · Marichyasana A L · Marichyasana B R |  |
| 30 | Marichyasana A L | 1 | Marichyasana A L · Marichyasana B R · Marichyasana B L |  |
| 31 | Marichyasana B R | 1 | Marichyasana B R · Marichyasana B L · Marichyasana C R |  |
| 32 | Marichyasana B L | 1 | Marichyasana B L · Marichyasana C R · Marichyasana C L |  |
| 33 | Marichyasana C R | 1 | Marichyasana C R · Marichyasana C L · Marichyasana D R |  |
| 34 | Marichyasana C L | 1 | Marichyasana C L · Marichyasana D R · Marichyasana D L |  |
| 35 | Navasana | 3 | Marichyasana D R · Marichyasana D L · Navasana | new video (break) |
| 36 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 37 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 38 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 39 | Bhujapidasana | 2 | Navasana · Bhujapidasana · Kurmasana | fewer reps than usual |
| 40 | Kurmasana | 1 | Kurmasana · Supta Kurmasana · Garbha Pindasana |  |
| 41 | Supta Kurmasana | 1 | Supta Kurmasana · Garbha Pindasana · Kukkutasana |  |
| 42 | Upavistha Konasana A | – | Garbha Pindasana · Kukkutasana · Baddha Konasana A | new video (break) |
| 43 | Upavistha Konasana B | 1 | Upavistha Konasana B · Supta Konasana · Supta Padangusthasana A R |  |
| 44 | Urdhva Mukha Paschimottanasana | – | Supta Konasana · Supta Padangusthasana A R · Supta Padangusthasana B R | new video (break) |
| 45 | Urdhva Dhanurasana | 2 | Setu Bandhasana · Urdhva Dhanurasana · Paschimottanasana A | new video (break) |
| 46 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 47 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 48 | Salamba Sarvangasana | 3 | Paschimottanasana A · Urdhva Dhanurasana · Salamba Sarvangasana | new video (break) |
| 49 | Halasana | 1 | Halasana · Karnapidasana · Urdhva Padmasana |  |
| 50 | Karnapidasana | 1 | Karnapidasana · Urdhva Padmasana · Pindasana |  |
| 51 | Urdhva Padmasana | 1 | Urdhva Padmasana · Pindasana · Matsyasana |  |
| 52 | Pindasana | 1 | Pindasana · Matsyasana · Uttana Padasana |  |
| 53 | Matsyasana | 1 | Matsyasana · Uttana Padasana · Sirsasana A |  |
| 54 | Uttana Padasana | 1 | Uttana Padasana · Sirsasana A · Sirsasana B |  |
| 55 | Sirsasana A | 1 | Sirsasana A · Sirsasana B · Balasana |  |
| 56 | Sirsasana B | 1 | Sirsasana B · Balasana · Yoga Mudra |  |

#### S3: every hold, suggestions today

| # | Truth | Rank | Top 3 | Cause |
|---|---|---|---|---|
| 1 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 2 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 3 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 4 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 5 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 6 | Adho Mukha Svanasana | 1 | Adho Mukha Svanasana · Padangusthasana · Padahastasana |  |
| 7 | Padangusthasana | 2 | Adho Mukha Svanasana · Padangusthasana · Padahastasana | fewer reps than usual |
| 8 | Padahastasana | 1 | Padahastasana · Utthita Trikonasana R · Utthita Trikonasana L |  |
| 9 | Utthita Trikonasana R | 1 | Utthita Trikonasana R · Utthita Trikonasana L · Parivrtta Trikonasana R |  |
| 10 | Utthita Trikonasana L | 1 | Utthita Trikonasana L · Parivrtta Trikonasana R · Parivrtta Trikonasana L |  |
| 11 | Parivrtta Trikonasana R | 1 | Parivrtta Trikonasana R · Parivrtta Trikonasana L · Utthita Parsvakonasana R |  |
| 12 | Parivrtta Trikonasana L | 1 | Parivrtta Trikonasana L · Utthita Parsvakonasana R · Utthita Parsvakonasana L |  |
| 13 | Utthita Parsvakonasana R | 1 | Utthita Parsvakonasana R · Utthita Parsvakonasana L · Parivrtta Parsvakonasana R |  |
| 14 | Utthita Parsvakonasana L | 1 | Utthita Parsvakonasana L · Parivrtta Parsvakonasana R · Parivrtta Parsvakonasana L |  |
| 15 | Parivrtta Parsvakonasana R | 1 | Parivrtta Parsvakonasana R · Parivrtta Parsvakonasana L · Prasarita Padottanasana A |  |
| 16 | Parivrtta Parsvakonasana L | 1 | Parivrtta Parsvakonasana L · Prasarita Padottanasana A · Prasarita Padottanasana B |  |
| 17 | Prasarita Padottanasana A | 1 | Prasarita Padottanasana A · Prasarita Padottanasana B · Prasarita Padottanasana C |  |
| 18 | Prasarita Padottanasana B | 1 | Prasarita Padottanasana B · Prasarita Padottanasana C · Prasarita Padottanasana D |  |
| 19 | Prasarita Padottanasana C | 1 | Prasarita Padottanasana C · Prasarita Padottanasana D · Parsvottanasana R |  |
| 20 | Prasarita Padottanasana D | 1 | Prasarita Padottanasana D · Parsvottanasana R · Parsvottanasana L |  |
| 21 | Parsvottanasana R | 1 | Parsvottanasana R · Parsvottanasana L · Utthita Hasta Padangusthasana A R |  |
| 22 | Parsvottanasana L | 1 | Parsvottanasana L · Utthita Hasta Padangusthasana A R · Utthita Hasta Padangusthasana B R |  |
| 23 | Utthita Hasta Padangusthasana A R | 1 | Utthita Hasta Padangusthasana A R · Utthita Hasta Padangusthasana B R · Utthita Hasta Padangusthasana C R |  |
| 24 | Utthita Hasta Padangusthasana B R | 1 | Utthita Hasta Padangusthasana B R · Utthita Hasta Padangusthasana C R · Utthita Hasta Padangusthasana A L |  |
| 25 | Utthita Hasta Padangusthasana C R | 1 | Utthita Hasta Padangusthasana C R · Utthita Hasta Padangusthasana A L · Utthita Hasta Padangusthasana B L |  |
| 26 | Utthita Hasta Padangusthasana A L | 1 | Utthita Hasta Padangusthasana A L · Utthita Hasta Padangusthasana B L · Utthita Hasta Padangusthasana C L |  |
| 27 | Utthita Hasta Padangusthasana B L | 1 | Utthita Hasta Padangusthasana B L · Utthita Hasta Padangusthasana C L · Ardha Baddha Padmottanasana R |  |
| 28 | Utthita Hasta Padangusthasana C L | 1 | Utthita Hasta Padangusthasana C L · Ardha Baddha Padmottanasana R · Ardha Baddha Padmottanasana L |  |
| 29 | Ardha Baddha Padmottanasana R | 1 | Ardha Baddha Padmottanasana R · Ardha Baddha Padmottanasana L · Utkatasana |  |
| 30 | Ardha Baddha Padmottanasana L | 1 | Ardha Baddha Padmottanasana L · Utkatasana · Virabhadrasana A R |  |
| 31 | Utkatasana | 1 | Utkatasana · Virabhadrasana A R · Virabhadrasana A L |  |
| 32 | Virabhadrasana A R | 1 | Virabhadrasana A R · Virabhadrasana A L · Virabhadrasana B R |  |
| 33 | Virabhadrasana A L | 1 | Virabhadrasana A L · Virabhadrasana B R · Virabhadrasana B L |  |
| 34 | Virabhadrasana B R | 1 | Virabhadrasana B R · Virabhadrasana B L · Dandasana |  |
| 35 | Virabhadrasana B L | 1 | Virabhadrasana B L · Dandasana · Paschimottanasana A |  |
| 36 | Dandasana | 1 | Dandasana · Paschimottanasana A · Paschimottanasana B |  |
| 37 | Paschimottanasana A | 1 | Paschimottanasana A · Paschimottanasana B · Paschimottanasana C |  |
| 38 | Paschimottanasana B | 1 | Paschimottanasana B · Paschimottanasana C · Purvottanasana |  |
| 39 | Paschimottanasana C | 1 | Paschimottanasana C · Purvottanasana · Ardha Baddha Padma Paschimottanasana R |  |
| 40 | Purvottanasana | 1 | Purvottanasana · Ardha Baddha Padma Paschimottanasana R · Ardha Baddha Padma Paschimottanasana L |  |
| 41 | Ardha Baddha Padma Paschimottanasana R | 1 | Ardha Baddha Padma Paschimottanasana R · Ardha Baddha Padma Paschimottanasana L · Tiryang Mukha Eka Pada Paschimottanasana R |  |
| 42 | Ardha Baddha Padma Paschimottanasana L | 1 | Ardha Baddha Padma Paschimottanasana L · Tiryang Mukha Eka Pada Paschimottanasana R · Tiryang Mukha Eka Pada Paschimottanasana L |  |
| 43 | Tiryang Mukha Eka Pada Paschimottanasana R | 1 | Tiryang Mukha Eka Pada Paschimottanasana R · Tiryang Mukha Eka Pada Paschimottanasana L · Janu Sirsasana A R |  |
| 44 | Tiryang Mukha Eka Pada Paschimottanasana L | 1 | Tiryang Mukha Eka Pada Paschimottanasana L · Janu Sirsasana A R · Janu Sirsasana A L |  |
| 45 | Janu Sirsasana A R | 1 | Janu Sirsasana A R · Janu Sirsasana A L · Janu Sirsasana B R |  |
| 46 | Janu Sirsasana A L | 1 | Janu Sirsasana A L · Janu Sirsasana B R · Janu Sirsasana B L |  |
| 47 | Janu Sirsasana B R | 1 | Janu Sirsasana B R · Janu Sirsasana B L · Janu Sirsasana C R |  |
| 48 | Janu Sirsasana B L | 1 | Janu Sirsasana B L · Janu Sirsasana C R · Janu Sirsasana C L |  |
| 49 | Janu Sirsasana C R | 1 | Janu Sirsasana C R · Janu Sirsasana C L · Marichyasana A R |  |
| 50 | Janu Sirsasana C L | 1 | Janu Sirsasana C L · Marichyasana A R · Marichyasana A L |  |
| 51 | Marichyasana A R | 1 | Marichyasana A R · Marichyasana A L · Marichyasana B R |  |
| 52 | Marichyasana A L | 1 | Marichyasana A L · Marichyasana B R · Marichyasana B L |  |
| 53 | Marichyasana B R | 1 | Marichyasana B R · Marichyasana B L · Marichyasana C R |  |
| 54 | Marichyasana B L | 1 | Marichyasana B L · Marichyasana C R · Marichyasana C L |  |
| 55 | Marichyasana C R | 1 | Marichyasana C R · Marichyasana C L · Marichyasana D R |  |
| 56 | Marichyasana C L | 1 | Marichyasana C L · Marichyasana D R · Marichyasana D L |  |
| 57 | Marichyasana D R | 1 | Marichyasana D R · Marichyasana D L · Navasana |  |
| 58 | Marichyasana D L | 1 | Marichyasana D L · Navasana · Bhujapidasana |  |
| 59 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 60 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 61 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 62 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 63 | Navasana | 1 | Navasana · Bhujapidasana · Kurmasana |  |
| 64 | Garbha Pindasana | – | Bhujapidasana · Navasana · Kurmasana | skipped entries |
| 65 | Kukkutasana | 1 | Kukkutasana · Baddha Konasana A · Baddha Konasana B |  |
| 66 | Bhujapidasana | – | Baddha Konasana A · Baddha Konasana B · Upavistha Konasana A | new video (break) |
| 67 | Kurmasana | 1 | Kurmasana · Supta Kurmasana · Baddha Konasana A |  |
| 68 | Supta Kurmasana | 1 | Supta Kurmasana · Baddha Konasana A · Baddha Konasana B |  |
| 69 | Baddha Konasana A | 1 | Baddha Konasana A · Baddha Konasana B · Upavistha Konasana A |  |
| 70 | Baddha Konasana B | 1 | Baddha Konasana B · Upavistha Konasana A · Upavistha Konasana B |  |
| 71 | Upavistha Konasana A | 1 | Upavistha Konasana A · Upavistha Konasana B · Supta Konasana |  |
| 72 | Upavistha Konasana B | 1 | Upavistha Konasana B · Supta Konasana · Supta Padangusthasana A R |  |
| 73 | Supta Konasana | 1 | Supta Konasana · Supta Padangusthasana A R · Supta Padangusthasana B R |  |
| 74 | Supta Padangusthasana A R | 1 | Supta Padangusthasana A R · Supta Padangusthasana B R · Supta Padangusthasana A L |  |
| 75 | Supta Padangusthasana B R | 1 | Supta Padangusthasana B R · Supta Padangusthasana A L · Supta Padangusthasana B L |  |
| 76 | Supta Padangusthasana A L | 1 | Supta Padangusthasana A L · Supta Padangusthasana B L · Ubhaya Padangusthasana |  |
| 77 | Supta Padangusthasana B L | 1 | Supta Padangusthasana B L · Ubhaya Padangusthasana · Urdhva Mukha Paschimottanasana |  |
| 78 | Urdhva Mukha Paschimottanasana | 2 | Ubhaya Padangusthasana · Urdhva Mukha Paschimottanasana · Setu Bandhasana | skipped entries |
| 79 | Ubhaya Padangusthasana | – | Setu Bandhasana · Urdhva Dhanurasana · Paschimottanasana A | other order |
| 80 | Setu Bandhasana | 1 | Setu Bandhasana · Urdhva Dhanurasana · Paschimottanasana A |  |
| 81 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 82 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 83 | Urdhva Dhanurasana | 1 | Urdhva Dhanurasana · Paschimottanasana A · Salamba Sarvangasana |  |
| 84 | Paschimottanasana A | 1 | Paschimottanasana A · Urdhva Dhanurasana · Salamba Sarvangasana |  |
| 85 | Salamba Sarvangasana | 1 | Salamba Sarvangasana · Halasana · Karnapidasana |  |
| 86 | Halasana | 1 | Halasana · Karnapidasana · Urdhva Padmasana |  |
| 87 | Karnapidasana | 1 | Karnapidasana · Urdhva Padmasana · Pindasana |  |
| 88 | Urdhva Padmasana | 1 | Urdhva Padmasana · Pindasana · Matsyasana |  |
| 89 | Pindasana | 1 | Pindasana · Matsyasana · Uttana Padasana |  |
| 90 | Matsyasana | 1 | Matsyasana · Uttana Padasana · Sirsasana A |  |
| 91 | Uttana Padasana | 1 | Uttana Padasana · Sirsasana A · Sirsasana B |  |
| 92 | Sirsasana A | 1 | Sirsasana A · Sirsasana B · Balasana |  |
| 93 | Sirsasana B | 1 | Sirsasana B · Balasana · Yoga Mudra |  |
| 94 | Balasana | 1 | Balasana · Yoga Mudra · Padmasana |  |
| 95 | Padmasana | 2 | Yoga Mudra · Padmasana · Utpluthih | skipped entries |
