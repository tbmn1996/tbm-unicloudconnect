from transcription_worker.main import main


def test_main() -> None:
    assert main() == 0
