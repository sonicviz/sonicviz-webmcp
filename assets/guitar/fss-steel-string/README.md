# FSS Steel-String Acoustic Guitar samples

These eight files are a range-limited subset of the FreePats FSS Steel-String
Acoustic Guitar sound bank. FreePats assembled the bank from Gary Campion's
FS Seagull Steel String Acoustic Guitar recordings.

- Source: [FreePats FSS Steel-String Acoustic Guitar](https://freepats.zenvoid.org/Guitar/steel-acoustic-guitar.html)
- Sound bank version: 2020-05-21
- Original recordings: Copyright 2008 Gary Campion
- FreePats modifications: 2016-2020 by `roberto@zenvoid.org`
- License: GNU General Public License version 3 or later, with the FreePats sound-sample exception
- License text: [GPL-3.0.txt](GPL-3.0.txt)

SonicViz selected high-velocity anchors at MIDI 40, 45, 50, 55, 60, 65, 70,
and 75 from the full-quality SFZ bank. On 2026-09-02, each selected mono WAV was
limited to 6.2 seconds, given a 150 ms terminal fade where applicable, and
losslessly converted to FLAC. The eight files total 885,637 bytes, cover the
application's MIDI 38-76 Guitar range with at most two semitones of pitch
shifting, and are loaded only after Guitar audio is first requested.

The converted files retain the upstream GPL terms and extend this exception:

> As a special exception, if you create a composition which uses these sounds,
> and mix these sounds or unaltered portions of these sounds into the
> composition, these sounds do not by themselves cause the entire composition
> as a whole to be covered by the GNU General Public License. This exception
> does not however invalidate any other reasons why the composition might be
> covered by the GNU General Public License.

The conversion used FFmpeg with FLAC compression level 8. Long anchors used a
6.05-second fade start and 0.15-second fade duration before the 6.2-second cap.
