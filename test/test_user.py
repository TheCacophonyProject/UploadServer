import json

class TestUser:
    def test_can_create_new_user(self, helper):
        print("If a new user Bob signs up", end="")
        bob = helper.given_new_user(self, "bob")

        print(
            "Then Bob should able to log in with his username in 'username' API field"
        )
        helper.login_as(bob.username)

        print(
            "And Bob should able to log in with his username in 'emailOrUsername' API field"
        )
        helper.login_with_name_or_email(bob.username, bob.username)

        print("And Bob should able to log in with his email in 'email' API field")
        helper.login_with_email(bob.username, bob.email)

        print(
            "And Bob should able to log in with his email in 'emailOrUsername' API field"
        )
        helper.login_with_name_or_email(bob.username, bob.email)

        print("And Bob should be able to see his details include user id. ")
        helper.admin_user().get_user_details(helper.admin_user())
        bob.get_user_details(bob)
        bobUserDetails = bob.get_user_details(helper.admin_user())

        print("Bob's user id is {}".format(bobUserDetails))

    def test_create_duplicate_user(self, helper):
        for num in range(2):
            print("If a user DuplicateBob signs up")
            try:
                helper.given_new_fixed_user(
                    "DuplicateBob"
                )
            except OSError as error:
                errorString = str(error)
                assert "request failed (422)" in errorString
                json_object = errorString[(errorString.find(":")+1):]
                parsedJson = json.loads(json_object)
                assert parsedJson['errorType'] == "validation"
                assert "'Username in use" in parsedJson['message'] or "Email in use" in parsedJson['message']
                print("Duplicate bob already exists")
