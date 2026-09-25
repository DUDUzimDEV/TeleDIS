class PermissionService:
    def has_access(self, user_role: str, required_roles: set[str]) -> bool:
        if user_role == "admin":
            return True
        return user_role in required_roles
