import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import Response
from rembg import new_session, remove

API_KEY = os.environ.get("API_KEY")

app = FastAPI()
session = new_session("isnet-general-use")


@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/remove-background")
async def remove_background(
    file: UploadFile = File(...),
    x_api_key: str | None = Header(default=None),
):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    input_bytes = await file.read()
    output_bytes = remove(input_bytes, session=session)
    return Response(content=output_bytes, media_type="image/png")
