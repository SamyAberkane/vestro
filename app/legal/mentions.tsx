import { LegalHeading, LegalParagraph, LegalScreen } from '@/components/legal-screen';

export default function MentionsLegalesScreen() {
  return (
    <LegalScreen title="Mentions Légales">
      <LegalParagraph>
        Conformément aux dispositions de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans
        l’économie numérique, il est précisé aux utilisateurs de l’application Vestro l’identité
        des différents intervenants dans le cadre de sa réalisation et de son suivi.
      </LegalParagraph>

      <LegalHeading>1. Éditeur de l’application</LegalHeading>
      <LegalParagraph>Raison sociale : Tailor Apps</LegalParagraph>
      <LegalParagraph>SIREN : 992 055 376</LegalParagraph>
      <LegalParagraph>Adresse : 59 rue de Ponthieu, 75008 Paris, France</LegalParagraph>
      <LegalParagraph>Email : contact@tailorapps.fr</LegalParagraph>
      <LegalParagraph>Téléphone : +33 7 82 57 66 32</LegalParagraph>
    </LegalScreen>
  );
}
