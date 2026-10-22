import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { StrKey } from '@stellar/stellar-sdk';
import * as Clipboard from 'expo-clipboard';
import { Formik } from 'formik';
import { TouchableOpacity } from 'react-native';
import * as Yup from 'yup';

import Box from '@/src/components/shared/Box';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

const AddressBookSchema = Yup.object().shape({
  label: Yup.string().required('Required'),
  address: Yup.string()
    .required('Required')
    .test(
      'stellar-address',
      'Enter a valid Stellar G-address or C-address',
      (value) => StrKey.isValidEd25519PublicKey(value ?? '') || StrKey.isValidContract(value ?? ''),
    ),
});

interface AddressBookFormProps {
  onSubmit: (values: { label: string; address: string }, formikHelpers: any) => void;
  initialAddress?: string;
  initialLabel?: string;
  isEditing?: boolean;
}

const AddressBookForm = ({
  onSubmit,
  initialAddress,
  initialLabel,
  isEditing,
}: AddressBookFormProps) => {
  const theme = useTheme<Theme>();

  return (
    <Formik
      initialValues={{ label: initialLabel ?? '', address: initialAddress ?? '' }}
      validationSchema={AddressBookSchema}
      onSubmit={onSubmit}
    >
      {({
        handleChange,
        handleBlur,
        handleSubmit,
        values,
        setFieldValue,
        errors,
        touched,
        isValid,
        dirty,
      }) => (
        <Box flex={1}>
          <Box flex={1} paddingHorizontal="m" pt="m">
            <Box mb="l">
              <Text variant="p7" color="textPrimary" fontWeight="600" mb="s">
                Label
              </Text>
              <Input
                placeholder="Label your address"
                onChangeText={handleChange('label')}
                onBlur={handleBlur('label')}
                value={values.label}
              />
              {touched.label && errors.label && (
                <Text variant="p8" color="inputError" mt="xs">
                  {errors.label}
                </Text>
              )}
            </Box>

            <Box mb="l">
              <Text variant="p7" color="textPrimary" fontWeight="600" mb="s">
                Wallet Address
              </Text>
              <Box minHeight={56} paddingVertical="s">
                <Input
                  placeholder="G... or C..."
                  placeholderTextColor={theme.colors.textSecondary}
                  onChangeText={handleChange('address')}
                  onBlur={handleBlur('address')}
                  value={values.address}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  style={{
                    flex: 1,
                    color: theme.colors.textPrimary,
                    fontSize: 15,
                    fontFamily: 'SFproRegular',
                    marginRight: 8,
                  }}
                  rightElement={
                    values.address ? (
                      <TouchableOpacity onPress={() => setFieldValue('address', '')}>
                        <Ionicons
                          name="close-circle"
                          size={20}
                          color={theme.colors.textSecondary}
                        />
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={async () => {
                          const text = await Clipboard.getStringAsync();
                          setFieldValue('address', text);
                        }}
                      >
                        <Box backgroundColor="primary" px="m" py="xs" borderRadius={8}>
                          <Text variant="p8" color="black" fontWeight="600">
                            Paste
                          </Text>
                        </Box>
                      </TouchableOpacity>
                    )
                  }
                />
              </Box>
              {touched.address && errors.address && (
                <Text variant="p8" color="inputError" mt="xs">
                  {errors.address}
                </Text>
              )}
            </Box>

            <Box mt="auto" paddingBottom="m">
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => handleSubmit()}
                disabled={!(isValid && (dirty || !!initialAddress))}
              >
                <Box
                  height={56}
                  backgroundColor={isValid && (dirty || !!initialAddress) ? 'primary' : 'bg900'}
                  borderRadius={28}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Text
                    variant="p6"
                    color={isValid && (dirty || !!initialAddress) ? 'black' : 'textSecondary'}
                    fontWeight="700"
                  >
                    {isEditing ? 'Save Changes' : 'Save Address'}
                  </Text>
                </Box>
              </TouchableOpacity>
            </Box>
          </Box>
        </Box>
      )}
    </Formik>
  );
};

export default AddressBookForm;
