import asyncio
from token_vault import get_m2m_token

async def test():
    print("Testing Auth0 connection...")
    token = await get_m2m_token()
    print(f"✅ Success! Got M2M token: {token[:30]}...")

asyncio.run(test())