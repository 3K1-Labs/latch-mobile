import SupportItem from '@/src/components/profile/SupportItem';
import Box from '@/src/components/shared/Box';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Linking, ScrollView } from 'react-native';

const HelpSupportScreen = () => {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  return (
    <Box
      flex={1}
      backgroundColor="cardbg"
      style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
    >
      <StatusBar style="light" />

      <UtilityHeader title="Help & Support" onBack={handleBack} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <SupportItem
          title="Email Support"
          description="support@getlatch.co"
          icon="mail-outline"
          onPress={() => Linking.openURL('mailto:support@getlatch.co').catch(() => {})}
        />
      </ScrollView>
    </Box>
  );
};

export default HelpSupportScreen;
