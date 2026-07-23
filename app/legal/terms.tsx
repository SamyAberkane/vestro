import { LegalHeading, LegalParagraph, LegalScreen } from '@/components/legal-screen';

export default function TermsOfUseScreen() {
  return (
    <LegalScreen title="Conditions d’Utilisation">
      <LegalParagraph>
        Les présentes Conditions d’Utilisation régissent l’usage de l’application Vestro, éditée
        par Tailor Apps. En créant un compte, tu acceptes ces conditions. Dernière mise à jour :
        juillet 2026.
      </LegalParagraph>

      <LegalHeading>1. Objet de l’application</LegalHeading>
      <LegalParagraph>
        Vestro te permet de cataloguer ta garde-robe, composer des tenues et gérer une liste
        d’envies, avec l’aide de fonctionnalités d’intelligence artificielle pour retoucher tes
        photos de vêtements.
      </LegalParagraph>

      <LegalHeading>2. Compte</LegalHeading>
      <LegalParagraph>
        L’accès à Vestro se fait via « Se connecter avec Apple ». Tu es responsable de la
        confidentialité de ton compte Apple. Tu peux supprimer ton compte Vestro et toutes les
        données associées à tout moment depuis l’application.
      </LegalParagraph>

      <LegalHeading>3. Contenu que tu ajoutes</LegalHeading>
      <LegalParagraph>
        Tu restes propriétaire des photos et informations que tu ajoutes à ton dressing. Tu nous
        autorises à les traiter (stockage, retouche automatique) dans le seul but de faire
        fonctionner l’application pour toi.
      </LegalParagraph>

      <LegalHeading>4. Abonnement Vestro Premium</LegalHeading>
      <LegalParagraph>
        Vestro Premium est un abonnement mensuel à 6,99 $, sans période d’essai, facturé via ton
        compte App Store. Il se renouvelle automatiquement chaque mois au même tarif, sauf
        résiliation au moins 24 heures avant la fin de la période en cours. Tu peux gérer ou
        résilier ton abonnement à tout moment depuis les réglages de ton compte Apple
        (Réglages → [ton nom] → Abonnements). Le paiement est prélevé par Apple sur ton moyen de
        paiement associé à ton identifiant Apple.
      </LegalParagraph>

      <LegalHeading>5. Usage autorisé</LegalHeading>
      <LegalParagraph>
        Tu t’engages à utiliser Vestro conformément à la loi et à ne pas tenter de perturber son
        fonctionnement ou d’accéder aux données d’autres utilisateurs.
      </LegalParagraph>

      <LegalHeading>6. Résiliation</LegalHeading>
      <LegalParagraph>
        Tu peux arrêter d’utiliser Vestro et supprimer ton compte à tout moment. Nous pouvons
        suspendre ou résilier l’accès en cas de non-respect de ces conditions.
      </LegalParagraph>

      <LegalHeading>7. Responsabilité</LegalHeading>
      <LegalParagraph>
        Vestro est fourni « en l’état ». Nous mettons tout en œuvre pour assurer la disponibilité
        et la fiabilité du service, sans garantir une disponibilité ininterrompue.
      </LegalParagraph>

      <LegalHeading>8. Droit applicable</LegalHeading>
      <LegalParagraph>
        Les présentes conditions sont régies par le droit français. Tout litige relève de la
        compétence des tribunaux de Paris.
      </LegalParagraph>

      <LegalHeading>9. Contact</LegalHeading>
      <LegalParagraph>
        Tailor Apps — 59 rue de Ponthieu, 75008 Paris, France — contact@tailorapps.fr
      </LegalParagraph>
    </LegalScreen>
  );
}
