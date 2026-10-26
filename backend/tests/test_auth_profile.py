import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import hash_password, verify_password
from app.models import Base, User
from app.routers.auth import ProfileUpdateRequest, update_profile


class ProfileUpdateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.user = User(
            name="Original Name",
            email="original@example.com",
            password_hash=hash_password("current-password"),
            role="user",
            is_active=True,
        )
        self.session.add(self.user)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_profile_and_password_update_requires_and_verifies_current_password(self):
        request = ProfileUpdateRequest(
            name="Updated Name",
            email="updated@example.com",
            current_password="current-password",
            new_password="updated-password",
        )

        response = update_profile(request, self.user, self.session)

        self.assertEqual(response["user"]["name"], "Updated Name")
        self.assertEqual(response["user"]["email"], "updated@example.com")
        self.assertTrue(verify_password("updated-password", self.user.password_hash))
        self.assertNotIn("password", response)

    def test_profile_update_rejects_an_incorrect_current_password(self):
        request = ProfileUpdateRequest(
            name="Changed Name",
            email="changed@example.com",
            current_password="incorrect-password",
        )

        with self.assertRaises(HTTPException) as raised:
            update_profile(request, self.user, self.session)

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(self.user.name, "Original Name")
        self.assertEqual(self.user.email, "original@example.com")


if __name__ == "__main__":
    unittest.main()
