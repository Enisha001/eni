"""
Unit tests for the sentence-chunking function used by the TTS server's
/synthesize-chunked endpoint (see tts_server.py, split_into_chunks).

Run with: .venv-tts/Scripts/python.exe -m pytest scripts/test_tts_chunking.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tts_server import split_into_chunks  # noqa: E402


def test_single_short_sentence_is_one_chunk():
    chunks = split_into_chunks("Hello there, how are you doing today?", max_chars=200)
    assert chunks == ["Hello there, how are you doing today?"]


def test_splits_on_sentence_boundaries():
    text = "This is the first sentence. This is the second sentence. This is the third one."
    chunks = split_into_chunks(text, max_chars=200)
    assert len(chunks) == 1  # all three fit comfortably under 200 chars, so they merge
    assert chunks[0] == text


def test_splits_on_sentence_boundaries_when_individually_near_limit():
    # Each sentence is long enough that two of them together would exceed max_chars,
    # so the sentence-boundary split must produce more than one chunk.
    long_a = "Alpha " * 20 + "sentence one."
    long_b = "Beta " * 20 + "sentence two."
    text = f"{long_a} {long_b}"
    chunks = split_into_chunks(text, max_chars=100)
    assert len(chunks) >= 2
    assert all(len(c) > 0 for c in chunks)


def test_long_sentence_falls_back_to_comma_split():
    text = ("This is a very long single sentence with many clauses, "
            "separated by commas, and it keeps going, and going, "
            "well past the configured character limit for a chunk")
    chunks = split_into_chunks(text, max_chars=40)
    assert len(chunks) > 1
    # Rejoining the chunks (roughly) should preserve all the words in the original
    rejoined_words = " ".join(chunks).split()
    original_words = text.split()
    assert rejoined_words == original_words


def test_tiny_fragments_are_merged_into_neighbours():
    text = "Hi! Got it. Okay then, let's continue with the rest of the plan now."
    chunks = split_into_chunks(text, max_chars=200)
    # "Hi!" and "Got it." are both under the 40-char MIN_CHUNK threshold, so
    # they must not survive as their own isolated chunks.
    assert "Hi!" not in chunks
    assert "Got it." not in chunks


def test_empty_string_returns_single_empty_chunk():
    assert split_into_chunks("", max_chars=200) == [""]


def test_whitespace_only_input_returns_single_chunk():
    chunks = split_into_chunks("   \n\t  ", max_chars=200)
    assert len(chunks) == 1
    assert chunks[0].strip() == ""


def test_merging_short_sentences_can_exceed_max_chars():
    """Documents a genuine limitation surfaced by this test suite: when every
    sentence is individually shorter than MIN_CHUNK (40 chars), the fragment-merge
    post-processing step chains them together with no upper bound, so max_chars
    is not actually a hard ceiling in this case. See report Section 5.1 / 6."""
    text = " ".join(["Hi."] * 15)  # 15 tiny "sentences", none reach 40 chars alone
    max_chars = 40
    chunks = split_into_chunks(text, max_chars=max_chars)
    assert len(chunks) == 1
    assert len(chunks[0]) > max_chars  # confirms max_chars is exceeded, not a hard cap
