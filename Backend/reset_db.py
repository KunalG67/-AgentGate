from database import engine
from sqlalchemy import text

print("Dropping tables...")
with engine.connect() as conn:
    conn.execute(text("DROP TABLE IF EXISTS step_up_challenges"))
    conn.execute(text("DROP TABLE IF EXISTS audit_log"))
    conn.execute(text("DROP TABLE IF EXISTS policies"))
    conn.commit()
print("Done! Restart your backend now.")