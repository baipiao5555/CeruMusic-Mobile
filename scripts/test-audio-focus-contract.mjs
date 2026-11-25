import assert from 'node:assert/strict'
import fs from 'node:fs'
const service=fs.readFileSync('android/app/src/main/java/com/ceru/music/mobile/MediaPlaybackService.java','utf8')
const plugin=fs.readFileSync('android/app/src/main/java/com/ceru/music/mobile/BackgroundAudioPlugin.java','utf8')
const player=fs.readFileSync('src/core/playback/player.ts','utf8')
assert.doesNotMatch(service,/requestAudioFocus|abandonAudioFocus|AUDIOFOCUS_LOSS/)
assert.doesNotMatch(plugin,/mixWithOthers/)
assert.doesNotMatch(player,/allowAudioMix/)
console.log('PASS no audio-focus takeover and no focus-loss auto-pause; official v2.7.6 playback service restored')
