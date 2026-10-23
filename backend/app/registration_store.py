"""Private server-owned enrollment pairs; publish only after both outputs exist.

Files staged by failed/interrupted enrollment may remain orphaned. Only an
exclusively published mapping makes a pair available for authentication.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid


class Registry:
    def __init__(self, root):
        root = Path(root)
        if not root.is_absolute():
            raise ValueError("Registration storage root must be absolute")
        if root.is_symlink():
            raise ValueError("Registration storage root cannot be a symlink")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = root.resolve()

    def _user_directory(self, user_id):
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("User identifier is required")
        return self.root / hashlib.sha256(user_id.encode("utf-8")).hexdigest()

    def _confined(self, path, directory, *, exists):
        path = Path(path)
        if not path.is_absolute() or not path.is_relative_to(directory):
            raise ValueError("Registration path outside user storage")
        # Resolve every component. A symlink inside storage is also forbidden,
        # even when its destination happens to remain within the same directory.
        for candidate in (path, *path.parents):
            if candidate.is_symlink():
                raise ValueError("Registration symlink is forbidden")
            if candidate == self.root:
                break
        if path.resolve() != path or not path.resolve().is_relative_to(directory):
            raise ValueError("Registration path outside user storage")
        if exists and not path.is_file():
            raise ValueError("Registration file is missing")
        return path

    def _mapping(self, user_id):
        directory = self._user_directory(user_id)
        return directory, directory / "registration.json"

    def registered(self, user_id):
        _, mapping = self._mapping(user_id)
        if not mapping.exists() and not mapping.is_symlink():
            return False
        self.resolve(user_id)
        return True

    def allocate(self, user_id):
        directory, mapping = self._mapping(user_id)
        if mapping.exists() or mapping.is_symlink():
            raise ValueError("User already has a registration")
        self._confined(directory, directory, exists=False)
        directory.mkdir(mode=0o700, exist_ok=True)
        generation = directory / str(uuid.uuid4())
        generation.mkdir(mode=0o700)
        return generation / "template.enc.json", generation / "calibration.json"

    @staticmethod
    def _digest(path):
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _pair(self, user_id, template_path, calibration_path):
        directory, _ = self._mapping(user_id)
        template = self._confined(template_path, directory, exists=True)
        calibration = self._confined(calibration_path, directory, exists=True)
        if (template.parent != calibration.parent or template.name != "template.enc.json"
                or calibration.name != "calibration.json" or template.parent.parent != directory):
            raise ValueError("Registration pair does not share an allocated generation")
        try:
            uuid.UUID(template.parent.name)
        except ValueError as error:
            raise ValueError("Registration generation is invalid") from error
        return template, calibration

    def publish(self, user_id, template_path, calibration_path):
        directory, mapping = self._mapping(user_id)
        template, calibration = self._pair(user_id, template_path, calibration_path)
        payload = {
            "version": 1, "user_id": user_id,
            "template": str(template.relative_to(self.root)),
            "calibration": str(calibration.relative_to(self.root)),
            "template_sha256": self._digest(template),
            "calibration_sha256": self._digest(calibration),
        }
        descriptor, staged = tempfile.mkstemp(prefix=".registration-", dir=directory)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump(payload, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            # Atomic exclusive publish: another request's mapping is never replaced.
            os.link(staged, mapping)
            descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            Path(staged).unlink(missing_ok=True)

    def resolve(self, user_id):
        directory, mapping = self._mapping(user_id)
        self._confined(mapping, directory, exists=True)
        try:
            payload = json.loads(mapping.read_text(encoding="utf-8"))
            expected = {"version", "user_id", "template", "calibration",
                        "template_sha256", "calibration_sha256"}
            if (not isinstance(payload, dict) or set(payload) != expected
                    or payload["version"] != 1 or payload["user_id"] != user_id):
                raise ValueError("Registration mapping identity/schema mismatch")
            template, calibration = self._pair(
                user_id, self.root / payload["template"], self.root / payload["calibration"],
            )
            if (self._digest(template) != payload["template_sha256"]
                    or self._digest(calibration) != payload["calibration_sha256"]):
                raise ValueError("Registration pair has changed")
            return template, calibration
        except (OSError, UnicodeError, TypeError, KeyError) as error:
            raise ValueError("Invalid registration mapping") from error
