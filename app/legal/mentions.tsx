import { LegalHeading, LegalParagraph, LegalScreen } from '@/components/legal-screen';
import { useI18n } from '@/i18n/context';

export default function MentionsLegalesScreen() {
  const { t } = useI18n();

  return (
    <LegalScreen title={t('legal.mentions.title')}>
      <LegalParagraph>{t('legal.mentions.intro')}</LegalParagraph>

      <LegalHeading>{t('legal.mentions.s1Title')}</LegalHeading>
      <LegalParagraph>{t('legal.mentions.companyLabel')} Tailor Apps</LegalParagraph>
      <LegalParagraph>{t('legal.mentions.sirenLabel')} 992 055 376</LegalParagraph>
      <LegalParagraph>{t('legal.mentions.addressLabel')} 59 rue de Ponthieu, 75008 Paris, France</LegalParagraph>
      <LegalParagraph>{t('legal.mentions.emailLabel')} contact@tailorapps.fr</LegalParagraph>
      <LegalParagraph>{t('legal.mentions.phoneLabel')} +33 7 82 57 66 32</LegalParagraph>
    </LegalScreen>
  );
}
