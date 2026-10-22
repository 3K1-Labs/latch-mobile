import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React, { useEffect, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { useWalletStore } from '@/src/store/wallet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import AddSignerForm from './AddSignerForm';
import AddSignerSuccess from './AddSignerSuccess';
import RemoveSignerPrompt from './RemoveSignerPrompt';
import SwipeableSignerItem from './SwipeableSignerItem';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SignersSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const { accounts, activeAccountIndex } = useWalletStore();
  const activeAccount = accounts[activeAccountIndex];
  const [step, setStep] = useState<'list' | 'add' | 'confirm_delete' | 'success'>('list');
  const [signerToDelete, setSignerToDelete] = useState<any>(null);
  const [addedSignerName, setAddedSignerName] = useState('');

  const [signers, setSigners] = useState([
    {
      id: '1',
      name: 'My iPhone (This Device)',
      address: activeAccount?.smartAccountAddress || 'GXYZ...AB12',
      isPrimary: true,
    },
    {
      id: '2',
      name: 'iPad',
      address: 'H1J2...X9Y0',
      isPrimary: false,
    },
  ]);

  useEffect(() => {
    if (visible) setStep('list');
  }, [visible]);

  const handleDelete = (id: string) => {
    const signer = signers.find((s) => s.id === id);
    if (signer) {
      setSignerToDelete(signer);
      setStep('confirm_delete');
    }
  };

  const confirmDelete = () => {
    if (signerToDelete) {
      setSigners((prev) => prev.filter((s) => s.id !== signerToDelete.id));
      setSignerToDelete(null);
      setStep('list');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      keyboardBehavior="extend"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={
        step === 'list' ? (
          <SheetHeader
            title="Signers"
            onBack={onClose}
            right={
              <TouchableOpacity
                onPress={() => setStep('add')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="add" size={20} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            }
          />
        ) : undefined
      }
      contentContainerStyle={{ flex: 1 }}
    >
      {step === 'list' ? (
        <KeyboardAwareScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          bottomOffset={16}
        >
          {/* Signer Management Card */}
          <Box backgroundColor="bg11" borderRadius={24} padding="l" mb="l">
            <Text variant="h11" color="textPrimary" fontWeight="700" mb="s">
              Signer Management
            </Text>
            <Text variant="p7" color="textSecondary" lineHeight={22} mb="l">
              Signers are devices or accounts allowed to authorize transactions. Requiring multiple
              signers adds extra security.
            </Text>

            <Box
              backgroundColor={isDark ? 'gray900' : 'cardbg'}
              borderRadius={16}
              padding="m"
              flexDirection="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Text variant="p7" color="textSecondary">
                Active Signers
              </Text>
              <Text variant="h10" color="textPrimary" fontWeight="700">
                {signers.length}
              </Text>
            </Box>
          </Box>

          {/* Signers List */}
          {signers.map((signer) => (
            <SwipeableSignerItem key={signer.id} signer={signer} onDelete={handleDelete} />
          ))}
        </KeyboardAwareScrollView>
      ) : step === 'add' ? (
        <AddSignerForm
          onBack={() => setStep('list')}
          onSubmit={(values) => {
            const newSigner = {
              id: Math.random().toString(),
              name: values.name,
              address: values.address,
              isPrimary: false,
            };
            setSigners((prev) => [...prev, newSigner]);
            setAddedSignerName(values.name);
            setStep('success');
          }}
        />
      ) : step === 'confirm_delete' ? (
        <RemoveSignerPrompt
          signerName={signerToDelete?.name || ''}
          onCancel={() => {
            setSignerToDelete(null);
            setStep('list');
          }}
          onConfirm={confirmDelete}
        />
      ) : (
        <AddSignerSuccess signerName={addedSignerName} onContinue={() => setStep('list')} />
      )}
    </BottomSheet>
  );
};

export default SignersSheet;
