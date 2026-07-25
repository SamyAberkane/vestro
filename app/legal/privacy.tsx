import { LegalHeading, LegalParagraph, LegalScreen } from '@/components/legal-screen';
import { useI18n } from '@/i18n/context';

export default function PrivacyPolicyScreen() {
  const { t } = useI18n();

  return (
    <LegalScreen title={t('legal.privacy.title')}>
      <LegalParagraph>{t('legal.privacy.intro')}</LegalParagraph>

      <LegalHeading>{t('legal.privacy.s1Title')}</LegalHeading>
      <LegalParagraph>{t('legal.privacy.s1Account')}</LegalParagraph>
      <LegalParagraph>{t('legal.privacy.s1Wardrobe')}</LegalParagraph>
      <LegalParagraph>{t('legal.privacy.s1Location')}</LegalParagraph>
      <LegalParagraph>{t('legal.privacy.s1Purchases')}</LegalParagraph>

      <LegalHeading>{t('legal.privacy.s2Title')}</LegalHeading>
      <LegalParagraph>{t('legal.privacy.s2Body')}</LegalParagraph>

      <LegalHeading>{t('legal.privacy.s3Title')}</LegalHeading>
      <LegalParagraph>{t('legal.privacy.s3Body')}</LegalParagraph>

      <LegalHeading>{t('legal.privacy.s4Title')}</LegalHeading>
      <LegalParagraph>{t('legal.privacy.s4Body')}</LegalParagraph>

      <LegalHeading>{t('legal.privacy.s5Title')}</LegalHeading>
      <LegalParagraph>{t('legal.privacy.s5Body')}</LegalParagraph>

      <LegalHeading>{t('legal.privacy.s6Title')}</LegalHeading>
      <LegalParagraph>Tailor Apps — 59 rue de Ponthieu, 75008 Paris, France — contact@tailorapps.fr</LegalParagraph>
    </LegalScreen>
  );
}
