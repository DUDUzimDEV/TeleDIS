class UserRepository:
    def get_by_username(self, username: str):
        return {"username": username, "role": "admin"} if username == "admin" else None
