"""
Simple token server for LiveKit authentication.
Generates JWT tokens for clients to connect to LiveKit rooms.
Note: Agents auto-dispatch via LiveKit framework when users join.
"""

import os
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
import uvicorn

app = FastAPI()

# Allow CORS for mobile app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# LiveKit credentials from environment
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "secretsecretsecretsecretsecretsecret")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "http://livekit-server:7880")
# Client-facing WebSocket URL (for mobile app to connect)
# Defaults to localhost for local dev, override for production deployments
LIVEKIT_WS_URL = os.getenv("LIVEKIT_WS_URL", "ws://localhost:7880")


@app.get("/token")
async def get_token(
    room: str = Query(default="vera-room", description="Room name"),
    identity: str = Query(default="user", description="Participant identity"),
):
    """Generate a LiveKit access token for joining a room."""

    token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    token.with_identity(identity)
    token.with_name(identity)
    token.with_grants(api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
        can_update_own_metadata=True,
        room_create=True,  # Allow room creation
    ))

    jwt_token = token.to_jwt()

    # Note: Agent auto-dispatches via LiveKit framework when room is created
    # Don't call dispatch_agent() here as it causes double dispatch

    return {
        "token": jwt_token,
        "room": room,
        "identity": identity,
        "url": LIVEKIT_WS_URL,
    }


async def dispatch_agent(room: str):
    """Dispatch an agent to the specified room."""
    try:
        lk_api = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

        # Also check if room already has an agent
        try:
            rooms = await lk_api.room.list_rooms(api.ListRoomsRequest(names=[room]))
            if rooms.rooms:
                participants = await lk_api.room.list_participants(
                    api.ListParticipantsRequest(room=room)
                )
                for p in participants.participants:
                    if 'agent' in p.identity.lower() or p.kind == 1:
                        print(f"Agent already in room {room}, skipping dispatch")
                        await lk_api.aclose()
                        return
        except Exception:
            pass

        dispatch = api.CreateAgentDispatchRequest(room=room)
        await lk_api.agent_dispatch.create_dispatch(dispatch)
        print(f"Agent dispatched to room: {room}")
        await lk_api.aclose()
    except Exception as e:
        print(f"Failed to dispatch agent: {e}")
        import traceback
        traceback.print_exc()


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7890)
