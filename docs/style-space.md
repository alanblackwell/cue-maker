# Style space: design note

Status: first version, 2026-10-22. Nothing here has been listened to yet.

## Why

Gary is not musically trained (he is a self-taught guitarist), so the cue
controls should not use music-theory vocabulary. Instead he picks a style by
dragging a point in a space labelled with three composers' surnames:

- **Satie**: Gary once commissioned a pianist to record extracts from the
  *Gymnopédies* for an earlier film, and his films refer to and quote one
  another. He will probably reuse those recordings in this score, so the
  generated music has to sit alongside them.
- **Ravel**
- **Jóhannsson** (Jóhann Jóhannsson)

All three are fairly gentle, ambient or minimalist. If the interface ever has
to explain a musical idea, it does so by saying which of these composers use
it, and how.

The aim is to give Gary something to react to rather than ask him abstract
questions, since he would find it hard to imagine what his answers would mean.

## The space

The three names are **reference points inside** the space, not its corners.
The point's position is converted to barycentric weights relative to the
three reference points. Every style setting is the weighted (affine) sum of
the three composers' values for that setting. Inside the triangle that is a
blend. Outside it, one weight goes above 1 and the others below 0, which
exaggerates whatever sets that composer apart from the other two: dragging
past Satie gives a more extreme, pastiche Satie. Settings are clamped to their
valid range, and the point is kept within a bounding circle.

On/off choices (counting in 3 or 4, whether there's a drone) switch at a
threshold of the blended value.

## Style settings (internal; never shown to Gary)

| Setting | Satie | Ravel | Jóhannsson |
| --- | --- | --- | --- |
| Beats per bar | 3 (bass note, then a chord on 2 and 3) | 3 | 4 |
| Bars per chord | 1, rocking between two chords | 2, speeding up into the hit | 4 or more |
| Chord colour | 7ths | 9ths and 11ths | plain, open, drones |
| Harmonic wandering | low | high | low |
| Tune | sparse, long notes | long and sweeping | short repeated fragment |
| Drive | none | Boléro-style snare pattern | slow repeating figure |
| Build | almost flat | one long crescendo | slow, heavy swell |
| Hit | soft arrival | full orchestra | deep boom, low brass |
| Sound | solo piano | strings, harp | strings, electronics |

Instrument layers fade in and out with the composers' weights, so dragging the
point changes the balance continuously, not in jumps.

## Sweet / Sour

Mood (Dark, Tense, Heroic…) is gone: there are far more possible moods than a
menu can hold, and its labels were theory terms (Phrygian, Lydian). It is
replaced by a **Sweet/Sour** control. Sweet uses the composers' material in the
usual way. Sour lets in more surprising and harsher elements, of a kind that
belongs to whichever composer the point is nearest:

| | Sour |
| --- | --- |
| Satie | odd chords (as in the *Gnossiennes*), a phrase left hanging, a beat of silence |
| Ravel | two keys at once; the waltz grinding and breaking up into the hit (*La Valse*) |
| Jóhannsson | grinding low brass and drones (*Sicario*), clashing string clusters, distortion |

The mechanism: the generator lays out fixed **sites** where a surprise could
happen (each bar, and the hit). Each site gets a fixed random number from the
*surprise* seed, and the surprise happens if that number is below the Sour
setting. So with the same seed, turning Sour up adds surprises one by one in
the same places, and turning it down takes them away in reverse order. **New
variation** picks different sites and surprises. The surprise seed can be
locked like any layer, so Gary can keep the music and re-roll only the
surprises, or the other way round. Fully sweet means no surprises at all.

## Small edit, small change

The random choices are drawn per bar, keyed by the bar's position counted
**back from the hit**, rather than from one random stream running through the
whole cue. Chords are also chosen backwards from the hit. So moving the start
point adds or removes bars at the beginning without re-shuffling the rest, and
dragging the style point or the Sour slider changes the material gradually.
(Changing the tempo or moving the hit still changes the bar grid, so the
material changes too.)

## Kept

- **Tempo**: it matters for the pacing of the edit. The tempo is still fitted
  so the hit lands on the first beat of a bar.
- **Energy** and **Build shape**.
- Key: D for now, the usual key of *Gymnopédie* No. 1. To be matched to Gary's
  recordings once we know which ones he'll use.

## Open

- The piano. The first attempt to synthesise a real piano sounded bad (Alan,
  first listen), so for the first review it is a soft electric piano (Rhodes-like
  FM) that doesn't pretend to be a piano. A real piano could come later from a
  better piano synthesiser, licensed samples (e.g. the free Salamander Grand,
  ~1–2 MB for the range used, which would break the no-samples rule), or Gary's
  own recordings.
- What to ask Gary, once he has this to react to: which recordings he'll reuse
  (key and tempo), whether he has the files, and how he knows Jóhannsson's work.
