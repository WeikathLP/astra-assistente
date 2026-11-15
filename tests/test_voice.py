import asyncio
import unittest
from unittest.mock import patch

import assistant


class FakeCommunicate:
    def __init__(self, text, voice, rate, pitch):
        self.args = (text, voice, rate, pitch)
        FakeCommunicate.last_args = self.args

    async def stream(self):
        yield {"type": "audio", "data": b"ID3test"}


class VoiceTests(unittest.TestCase):
    def test_neural_speech_uses_clean_text_and_bounded_controls(self):
        fake_module = type("FakeEdge", (), {"Communicate": FakeCommunicate})
        with patch.object(assistant, "VOICE_CACHE", assistant.NEURAL_FALLBACK), patch.object(assistant, "edge_module", return_value=fake_module):
            audio = assistant.synthesize_voice("Olá, **pessoa**!", "pt-BR-FranciscaNeural", 999, -999)
        self.assertEqual(audio, b"ID3test")
        self.assertEqual(FakeCommunicate.last_args, ("Olá, pessoa!", "pt-BR-FranciscaNeural", "+50%", "-20Hz"))

    def test_unknown_voice_is_rejected(self):
        with patch.object(assistant, "VOICE_CACHE", assistant.NEURAL_FALLBACK):
            with self.assertRaises(ValueError):
                assistant.synthesize_voice("Olá", "unknown", 0, 0)


if __name__ == "__main__":
    unittest.main()
