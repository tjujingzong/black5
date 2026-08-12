Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
$synth.Rate = 0
$synth.Volume = 100
$good = Join-Path $PSScriptRoot '..\public\audio\voice\quick-good-play.wav'
$just = Join-Path $PSScriptRoot '..\public\audio\voice\quick-just-this.wav'
$synth.SetOutputToWaveFile($good)
$synth.Speak(([char]0x4f60)+([char]0x7684)+([char]0x724c)+([char]0x6253)+([char]0x5f97)+([char]0x592a)+([char]0x597d)+([char]0x4e86))
$synth.SetOutputToWaveFile($just)
$synth.Speak(([char]0x5c31)+([char]0x8fd9)+([char]0x3f))
$synth.Dispose()
