# Promo

`instagram-story.mp4`: 24 s Instagram Story ad, 1080x1920, 30 fps, -15.4 LUFS, true peak -1.4 dB.

Built with [AI Edit Studio](https://github.com/laaielichter/ai-edit-studio) from
`instagram-story.story.json` (aes.story/1, 120 bpm, synthwave, seed 7). To rebuild, set the
end card's `logo` to the absolute path of `logo-512.png` and run:

```sh
node cli.mjs studio apply --request story-request.json   # {"story": <instagram-story.story.json>}
```

Every number on screen comes from this repo: 1078 classes (`README.md`), the review output
of the messy fixture (`docs/demo.svg`), and 84/84 fully typed runs (`bench/RESULTS.md`).
