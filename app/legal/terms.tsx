import { LegalHeading, LegalParagraph, LegalScreen } from '@/components/legal-screen';
import { useI18n } from '@/i18n/context';

export default function TermsOfUseScreen() {
  const { t } = useI18n();

  return (
    <LegalScreen title={t('legal.terms.title')}>
      <LegalParagraph>{t('legal.terms.intro')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s1Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s1Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s2Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s2Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s3Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s3Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s4Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s4Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s5Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s5Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s6Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s6Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s7Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s7Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s8Title')}</LegalHeading>
      <LegalParagraph>{t('legal.terms.s8Body')}</LegalParagraph>

      <LegalHeading>{t('legal.terms.s9Title')}</LegalHeading>
      <LegalParagraph>Tailor Apps — 59 rue de Ponthieu, 75008 Paris, France — contact@tailorapps.fr</LegalParagraph>
    </LegalScreen>
  );
}
