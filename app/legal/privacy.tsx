import { LegalHeading, LegalParagraph, LegalScreen } from '@/components/legal-screen';

export default function PrivacyPolicyScreen() {
  return (
    <LegalScreen title="Politique de confidentialité">
      <LegalParagraph>
        La présente politique explique quelles données Tailor Apps (« nous »), éditeur de
        l’application Vestro, collecte lorsque tu utilises l’application, pourquoi, et comment tu
        peux y accéder ou les supprimer. Dernière mise à jour : juillet 2026.
      </LegalParagraph>

      <LegalHeading>1. Données que nous collectons</LegalHeading>
      <LegalParagraph>
        • Compte : ton identifiant Apple (nom et email si tu choisis de les partager) via
        « Se connecter avec Apple », utilisé uniquement pour créer et sécuriser ton compte.
      </LegalParagraph>
      <LegalParagraph>
        • Dressing : les photos de vêtements que tu ajoutes, ainsi que les informations que tu
        renseignes ou que l’application détecte automatiquement (nom, catégorie, couleur, prix).
      </LegalParagraph>
      <LegalParagraph>
        • Localisation : uniquement si tu l’autorises, pour afficher la météo du jour. Ta position
        est utilisée le temps de la requête et n’est pas conservée sur nos serveurs.
      </LegalParagraph>
      <LegalParagraph>
        • Achats : le statut de ton abonnement Premium (actif ou non), géré par Apple via
        In-App Purchase — nous ne recevons jamais tes moyens de paiement.
      </LegalParagraph>

      <LegalHeading>2. Comment tes données sont utilisées</LegalHeading>
      <LegalParagraph>
        Tes photos de vêtements sont envoyées à l’API Gemini de Google pour être recadrées sur fond
        blanc et pour en identifier automatiquement la catégorie et la couleur. Tes données de
        compte et de dressing sont stockées chez Supabase (base de données et stockage de fichiers),
        avec un accès strictement limité à ton propre compte. Ta position, quand tu l’autorises,
        est envoyée à Open-Meteo (service météo sans compte ni identifiant) pour obtenir la météo
        locale, sans être stockée.
      </LegalParagraph>

      <LegalHeading>3. Ce que nous ne faisons pas</LegalHeading>
      <LegalParagraph>
        Nous ne vendons pas tes données, n’affichons pas de publicité ciblée et n’utilisons pas de
        traceurs publicitaires tiers.
      </LegalParagraph>

      <LegalHeading>4. Tes droits</LegalHeading>
      <LegalParagraph>
        Conformément au RGPD, tu disposes d’un droit d’accès, de rectification, d’effacement et de
        portabilité de tes données. Tu peux supprimer ton compte et toutes les données associées à
        tout moment depuis l’application (Compte → Supprimer mon compte), ou nous écrire à
        contact@tailorapps.fr pour toute autre demande.
      </LegalParagraph>

      <LegalHeading>5. Conservation des données</LegalHeading>
      <LegalParagraph>
        Tes données sont conservées tant que ton compte existe. Elles sont supprimées
        définitivement, ainsi que tes photos, dès que tu supprimes ton compte.
      </LegalParagraph>

      <LegalHeading>6. Contact</LegalHeading>
      <LegalParagraph>
        Tailor Apps — 59 rue de Ponthieu, 75008 Paris, France — contact@tailorapps.fr
      </LegalParagraph>
    </LegalScreen>
  );
}
