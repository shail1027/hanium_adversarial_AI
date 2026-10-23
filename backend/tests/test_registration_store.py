import json
from pathlib import Path

import pytest

from backend.app.registration_store import Registry


def enrolled(registry, user):
    template, calibration = registry.allocate(user)
    template.write_bytes(f"encrypted template {user}".encode())
    calibration.write_bytes(f"calibration {user}".encode())
    registry.publish(user, template, calibration)
    return template, calibration


def mapping_path(pair):
    return pair[0].parent.parent / "registration.json"


def test_two_users_and_restart_keep_distinct_pairs(tmp_path):
    registry = Registry(tmp_path)
    alice = enrolled(registry, "alice")
    bob = enrolled(registry, "bob")
    restarted = Registry(tmp_path)
    assert restarted.resolve("alice") == alice
    assert restarted.resolve("bob") == bob
    assert alice != bob
    assert restarted.registered("alice")
    assert not restarted.registered("unknown")
    assert "alice" not in str(alice[0])


def test_duplicate_publish_preserves_first_mapping(tmp_path):
    registry = Registry(tmp_path)
    # Two concurrent requests allocate before either publishes.
    first = registry.allocate("alice")
    second = registry.allocate("alice")
    for pair in (first, second):
        for file in pair:
            file.write_bytes(b"test")
    registry.publish("alice", *first)
    original = mapping_path(first).read_bytes()
    with pytest.raises(FileExistsError):
        registry.publish("alice", *second)
    assert mapping_path(first).read_bytes() == original
    assert registry.resolve("alice") == first
    with pytest.raises(ValueError):
        registry.allocate("alice")


def test_copied_user_mapping_rejected(tmp_path):
    registry = Registry(tmp_path)
    alice = enrolled(registry, "alice")
    bob = enrolled(registry, "bob")
    mapping_path(alice).write_bytes(mapping_path(bob).read_bytes())
    with pytest.raises(ValueError, match="identity"):
        registry.resolve("alice")


def test_rewritten_identity_still_cannot_select_other_user_paths(tmp_path):
    registry = Registry(tmp_path)
    alice = enrolled(registry, "alice")
    bob = enrolled(registry, "bob")
    payload = json.loads(mapping_path(bob).read_text())
    payload["user_id"] = "alice"
    mapping_path(alice).write_text(json.dumps(payload))
    with pytest.raises(ValueError, match="outside user"):
        registry.resolve("alice")


def test_calibration_substitution_rejected(tmp_path):
    registry = Registry(tmp_path)
    alice = enrolled(registry, "alice")
    bob = enrolled(registry, "bob")
    alice[1].write_bytes(bob[1].read_bytes())
    with pytest.raises(ValueError, match="changed"):
        registry.resolve("alice")


@pytest.mark.parametrize("corruption", ["missing", "bad-json", "missing-template", "symlink"])
def test_missing_corrupt_or_symlink_mapping_rejected(tmp_path, corruption):
    registry = Registry(tmp_path)
    pair = enrolled(registry, "alice")
    mapping = mapping_path(pair)
    if corruption == "missing":
        mapping.unlink()
    elif corruption == "bad-json":
        mapping.write_text("{")
    elif corruption == "missing-template":
        pair[0].unlink()
    else:
        content = mapping.read_bytes()
        mapping.unlink()
        other = tmp_path / "other.json"
        other.write_bytes(content)
        mapping.symlink_to(other)
    with pytest.raises(ValueError):
        registry.resolve("alice")


def test_partial_enrollment_has_no_visible_registration(tmp_path):
    registry = Registry(tmp_path)
    template, calibration = registry.allocate("alice")
    template.write_bytes(b"partial")
    with pytest.raises(ValueError, match="missing"):
        registry.publish("alice", template, calibration)
    assert not registry.registered("alice")
    assert template.read_bytes() == b"partial"


def test_parent_symlink_and_outside_paths_rejected(tmp_path):
    root = tmp_path / "storage"
    registry = Registry(root)
    template, calibration = registry.allocate("alice")
    template.parent.rmdir()
    external = tmp_path / "external"
    external.mkdir()
    (external / template.name).write_bytes(b"a")
    (external / calibration.name).write_bytes(b"b")
    template.parent.symlink_to(external)
    with pytest.raises(ValueError, match="symlink"):
        registry.publish("alice", template, calibration)
    with pytest.raises(ValueError, match="outside"):
        registry.publish("bob", external / template.name, external / calibration.name)


def test_absolute_root_required():
    with pytest.raises(ValueError, match="absolute"):
        Registry(Path("relative"))
