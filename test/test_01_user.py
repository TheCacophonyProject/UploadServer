class TestUser:
    def test_can_create_new_user(self, helper):
        print("If a new user Bob signs up", end='')
        bob = helper.given_new_user(self, 'bob')

        print("Then Bob should able to log in")
        bob_login = helper.login_as(bob.username)

        print('And Bob should be able to see his details include user id. ')
        helper.admin_user().get_user_details(helper.admin_user())
        bob.get_user_details(bob)
        userdetails = bob.get_user_details(helper.admin_user())

        print("Bob's user id is {}".format(userdetails))

    def test_can_download_recording(self, helper):
        device = helper.given_new_device(self, 'device')
        recording = device.has_recording()

        print("\nA user should be able to downlad the recording")
        user = helper.admin_user()
        user.can_download_correct_recording(recording)
