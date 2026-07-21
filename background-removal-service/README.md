---
title: Vestro Background Removal
emoji: 🧥
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
---

# Vestro — service de suppression de fond

Petit service FastAPI qui détoure une photo de vêtement avec [rembg](https://github.com/danielgatis/rembg) (modèle `isnet-general-use`, open-source, gratuit). Conçu pour être déployé sur un tier gratuit (Hugging Face Spaces) ou n'importe quel hébergeur Docker.

## Déployer sur Hugging Face Spaces (gratuit)

1. Va sur https://huggingface.co/new-space
2. Choisis un nom, le SDK **Docker**, visibilité au choix
3. Une fois le Space créé, pousse ce dossier dedans :
   ```
   git remote add space https://huggingface.co/spaces/<ton-user>/<nom-du-space>
   git push space main
   ```
   (ou glisse-dépose les fichiers via l'interface web du Space)
4. (Optionnel mais recommandé) Dans **Settings → Variables and secrets** du Space, ajoute un secret `API_KEY` avec une valeur au choix — ça évite que n'importe qui sur internet consomme ton quota gratuit. Si tu ne le définis pas, l'endpoint reste ouvert sans authentification.
5. Le Space te donne une URL du type `https://<ton-user>-<nom-du-space>.hf.space`. C'est cette URL qu'il faut mettre dans le `.env` de l'app (voir `app/.env.example`... en fait à la racine du projet Expo).

Le tier gratuit "endort" le Space après une période d'inactivité : la première requête après une pause peut prendre 30 à 60 secondes le temps qu'il redémarre.

## Tester en local

```bash
pip install -r requirements.txt
uvicorn app:app --reload
curl -F "file=@photo.jpg" http://localhost:8000/remove-background -o out.png
```

## Endpoint

`POST /remove-background`
- Body: `multipart/form-data` avec un champ `file` (l'image)
- Header optionnel `x-api-key` si `API_KEY` est configuré côté serveur
- Réponse : image PNG avec fond blanc uni (le vêtement détouré posé sur fond blanc, pas de transparence)
