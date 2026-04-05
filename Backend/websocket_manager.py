from fastapi import WebSocket
from typing import Set


class WebSocketManager:
    def __init__(self):
        # set for O(1) ops and safe iteration
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)  # safe even if already gone

    async def broadcast(self, message: dict):
        dead: Set[WebSocket] = set()

        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # died mid-broadcast
                dead.add(connection)

        # collect first, then remove — never mutate while iterating
        self.active_connections -= dead


manager = WebSocketManager()


async def broadcast(message: dict):
    await manager.broadcast(message)