# BeatBloom

Compose a beat. Watch it bloom. Share the link.

BeatBloom is a browser step sequencer: a 4-track x 16-step grid (kick, snare, hi-hat, lead synth) whose notes drive a synchronized generative bloom visualizer. The lead columns are tuned to A minor pentatonic, so any pattern you draw stays in key. The whole song - pattern, tempo, and visual theme - is encoded in the share link: no account, no server, nothing uploaded.

## Run it

It is a fully static site. Open `index.html` directly, or serve the folder:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

Deployed version: (GitHub Pages link added at submission)

## Features

- Web Audio step sequencer with a 25 ms lookahead scheduler: synthesized kick, snare, hi-hat, and a detuned-saw lead through a lowpass envelope.
- Column-tuned lead: each of the 16 columns maps to a note in A minor pentatonic across two octaves.
- Canvas bloom visualizer driven by the same scheduled events that play the notes (exact sync), with three themes and ambient idle blooms.
- Share links: song state is packed into 10 bytes in the URL hash - opening the link restores pattern, tempo, and theme.
- Export WAV: renders the exact current song offline (OfflineAudioContext, 4 bars, 44.1 kHz stereo) and downloads it.
- Accessibility: keyboard-operable cells, visible focus rings, mute toggle, `prefers-reduced-motion` support, scrollable large-touch grid on small screens.

## Built with

Vanilla HTML/CSS/JavaScript, Web Audio API, Canvas 2D. No dependencies, no build step.

Built during Next Byte Hacks V5 (build window Nov 2026). AI coding assistance (ChatGPT, Qwen, Duck.ai) was used for ideation; all code was written, tested, and verified for this event.
