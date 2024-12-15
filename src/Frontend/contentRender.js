import React, { useState, useEffect, useRef } from "react";
import {
    Box, TextField, Button, InputAdornment, LinearProgress, Typography, Menu, MenuItem, IconButton, List, Grid,
    ListItem, ListItemText, ListItemSecondaryAction, Select, InputLabel, FormControl, ThemeProvider, createTheme,
} from '@mui/material';
import { Delete, ArrowLeft, ArrowRight, AccountCircle, Timeline } from "@mui/icons-material";

const parseJSONWithText = (content) => {
    const match = content.match(/(.*?)`?`?`?\s*([\{\[].*?[\}\]])\s*`?`?`?(.*)/s);
    if (!match?.[2]) return null;
    const jsonString = match[2].replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''); // remove JSON comments
    return JSON.parse(jsonString);
};

const formatDate = (date) => date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

const calculateBMR = (gender, age, weight, height) => parseInt(gender === 'male'
    ? 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age)
    : 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age));

const isMobile = window.innerWidth < 960;
const fontSize = isMobile ? '0.675rem' : '0.875rem';

const formatFloatValue = (value) => {
    value = parseFloat(parseFloat(value).toFixed(4));
    const fractionalPart = value % 1;
    if (fractionalPart >= 0.99) return Math.ceil(value);
    if (Math.abs(fractionalPart - 0.99) < 0.01) return parseFloat(value.toFixed(1));
    return value;
};

const EditableForm = ({ KB, msgIndex, messages, setMessages, itemsAPI, chatAPI, setBlockingLoading }) => {
    const [formData, setFormData] = useState(parseJSONWithText(messages[msgIndex].content));
    const previousMultiplierFieldRef = useRef(formData.weight);
    const [itemAdded, setItemAdded] = useState(false);
    const attributes = KB?.itemTypes?.[formData?.itemType]?.attributes || [];

    useEffect(() => {
        const updatedFormData = { ...formData };
        let hasChange = false;

        attributes.forEach(({ attrType, attrName }) => {
            if (attrType.startsWith('float') && typeof updatedFormData[attrName] === 'string' && !updatedFormData[attrName]?.endsWith('.')) {
                const parsedValue = formatFloatValue(updatedFormData[attrName]);
                if (!isNaN(parsedValue)) {
                    hasChange = true;
                    updatedFormData[attrName] = parsedValue;
                }
            }
        })

        if (hasChange) setFormData(updatedFormData);
    }, [formData, attributes]);

    useEffect(() => {
        setFormData(parseJSONWithText(messages[msgIndex].content));
    }, [messages, msgIndex]);

    useEffect(() => {
        const previousMultiplierField = previousMultiplierFieldRef.current;
        const currentMultiplierField = formData.weight
        if (currentMultiplierField > 0 && previousMultiplierField !== currentMultiplierField) {
            const ratio = previousMultiplierField === undefined ? 1 : currentMultiplierField / previousMultiplierField;
            const updatedFormData = { ...formData };
            attributes.forEach(({ attrType, attrName }) => {
                if (attrType.startsWith('float') && attrName !== 'weight') {
                    updatedFormData[attrName] = formatFloatValue(formData[attrName] * ratio);
                }
            })
            setFormData(updatedFormData);
            previousMultiplierFieldRef.current = currentMultiplierField;
        }
    }, [formData.weight, attributes]);

    useEffect(() => {
        if (!itemAdded && !formData?.itemId && window.openkbs.hasActivity(15)) {
            handleSave({ autoCreate: true });
            setItemAdded(true);
        }
    }, [formData, itemAdded]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSave = async ({ autoCreate = false }) => {
        const chatId = window.openkbs.parseChatId();
        setBlockingLoading(true);
        try {
            const action = formData?.itemId ? itemsAPI.updateItem : itemsAPI.createItem;
            const { itemId } = await action({
                itemId: formData?.itemId,
                KBData: KB,
                itemType: formData?.itemType,
                attributes: attributes.map(({ attrType, attrName, encrypted }) => ({ attrType, attrName, encrypted })),
                item: formData
            });
            const updatedMessageContent = JSON.stringify(formData?.itemId ? formData : { ...formData, itemId });
            setTimeout(() => chatAPI.chatEditMessage(chatId, messages[msgIndex].msgId, updatedMessageContent)
                .then(() => setBlockingLoading(false)), autoCreate ? 1000 : 0);
            setMessages(prevMessages => {
                const newMessages = [...prevMessages];
                newMessages[msgIndex] = { ...newMessages[msgIndex], content: updatedMessageContent };
                return newMessages;
            });
        } catch (e) {
            console.error(e);
            setBlockingLoading(false);
        }
    };

    return (
        <ThemeProvider theme={() => createTheme(window.openkbsTheme)}>
            <Box component="form" sx={{ width: '98%', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, mt: 3 }}>
                {attributes.map((attr, index) => (
                    <TextField
                        key={attr.attrName}
                        name={attr.attrName}
                        size="small"
                        label={attr.label}
                        placeholder={attr.placeholder}
                        value={formData[attr.attrName] || ''}
                        onChange={handleChange}
                        variant="outlined"
                        InputProps={{
                            endAdornment: attr.unit ? <InputAdornment position="end">{attr.unit}</InputAdornment> : null,
                        }}
                        sx={index === 0 ? { gridColumn: 'span 2' } : {}}
                    />
                ))}
                <Box sx={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Button variant="contained" color="primary" sx={{ width: '100%', height: '40px' }} onClick={handleSave}>
                        {formData?.itemId ? 'Update' : 'Add'}
                    </Button>
                </Box>
            </Box>
        </ThemeProvider>
    );
};

const onRenderChatMessage = async (params) => {
    const { content, role } = params.messages[params.msgIndex];
    const parsedContent = role === 'assistant' ? parseJSONWithText(content) : null;
    if (!parsedContent) return null;
    return <EditableForm {...params} />;
};

const onDeleteChatMessage = async (params) => {
    const { chatId, message, itemsAPI, KB, setBlockingLoading } = params;
    const parsedContent = message.role === 'assistant' ? parseJSONWithText(message.content) : null;
    if (!parsedContent?.itemType || !parsedContent?.itemId) return null;
    const { itemId, itemType } = parsedContent;
    setBlockingLoading(true);
    await itemsAPI.deleteItem({ itemId, KBData: KB, itemType });
    setBlockingLoading(false);
};

const castValues = (o) => Object.entries(o).reduce((acc, [key, value]) => ({ ...acc, [key]: parseFloat(parseFloat(value).toFixed(2)) }), {});

const ItemList = ({ items, onDelete }) => {
    const truncateText = (text, maxLength) => text.length > maxLength ? text.substring(0, maxLength) + '...' : text;

    return (
        <Box sx={{ width: '100%', maxWidth: '500px', maxHeight: '300px', overflowY: 'auto' }}>
            <List>
                {items?.map((item, index) => (
                    <ListItem key={index} divider>
                        <ListItemText
                            primary={
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography sx={{ fontSize: '0.775rem' }}>{truncateText(item.item?.name, 30)}</Typography>
                                    <Typography component="span" sx={{ fontSize: '0.775rem', fontWeight: 'bold', ml: 1 }}>
                                        ({item.item?.calories || item.item?.caloriesBurned} cals)
                                    </Typography>
                                </Box>
                            }
                        />
                        <ListItemSecondaryAction>
                            <IconButton edge="end" aria-label="delete" onClick={() => onDelete(item?.meta?.itemId)}>
                                <Delete style={{ fontSize: 16 }} />
                            </IconButton>
                        </ListItemSecondaryAction>
                    </ListItem>
                ))}
            </List>
        </Box>
    );
}

const StatsProgressBars = ({ foodItems, activityItems, profile, setRenderSettings, renderSettings, itemsAPI, KB, setBlockingLoading }) => {
    const [anchorEl, setAnchorEl] = useState(null);
    const [menuType, setMenuType] = useState(null);
    const totalNutrients = aggregateNutrients(foodItems);
    const totalActivities = aggregateActivities(activityItems);
    const { age, calorieDeficit, carbPercentage, fatPercentage, gender, height, proteinPercentage, weight } = profile;

    const BMR = calculateBMR(gender, age, weight, height);
    const totalCalories = BMR + (totalActivities?.caloriesBurned || 0);
    const maxCalories = totalCalories - calorieDeficit;

    const maxAllowedNutrients = {
        calories: maxCalories,
        proteins: (maxCalories * (proteinPercentage / 100)) / 4,
        carbs: (maxCalories * (carbPercentage / 100)) / 4,
        fats: (maxCalories * (fatPercentage / 100)) / 9
    };

    useEffect(() => {
        if (!profile || renderSettings?.instructionSuffix?.includes('\nUserProfile:\n')) return;
        setRenderSettings(prev => {
            let suffix = prev?.instructionSuffix || '';
            suffix += `\n\n\nUserProfile:\n(Weight in kg, height in cm)\n` + JSON.stringify(profile, null, 2);
            suffix += `\n\n\nMaxAllowedNutrientsToday:\n(all in grams)\n` + JSON.stringify(castValues(maxAllowedNutrients), null, 2);
            suffix += `\n\n\nConsumedNutrientsToday:\n(all in grams)\n` + JSON.stringify(castValues(totalNutrients), null, 2);
            suffix += `\n\n\nActivitiesToday:\n` + JSON.stringify(activityItems?.map(o => o.item), null, 2);
            suffix += `\n\n\nMealsToday:\n` + JSON.stringify(foodItems?.map(o => o.item), null, 2);
            return {...prev, instructionSuffix: suffix}
        })
    }, [profile, totalNutrients, totalActivities]);

    const colors = {
        calories: 'primary',
        proteins: 'secondary',
        carbs: 'success',
        fats: 'warning'
    };

    const handleMenuOpen = (event, type) => {
        setAnchorEl(event.currentTarget);
        setMenuType(type);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
        setMenuType(null);
    };

    const handleDeleteItem = async (itemId) => {
        setBlockingLoading(true);
        await itemsAPI.deleteItem({ itemId, KBData: KB, itemType: menuType });
        setBlockingLoading(false);
    };

    return (
        <Box sx={{ width: '100%', pb: 1, textAlign: 'center' }}>
            {['Calories', 'Proteins', 'Carbs', 'Fats'].map((nutrient, index) => {
                const value = totalNutrients?.[nutrient.toLowerCase()] || 0;
                const maxValue = maxAllowedNutrients[nutrient.toLowerCase()];
                const color = colors[nutrient.toLowerCase()];
                const percentage = (value / maxValue) * 100;

                return (
                    <Box key={index} sx={{ mt: 0, width: '100%' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ textAlign: 'left', width: '80px' }}>
                                {nutrient}
                            </Typography>
                            <Typography variant="caption" sx={{ textAlign: 'left', width: '100px' }}>
                                {value} / {maxValue.toFixed(0)} {nutrient === 'Calories' ? 'cals' : 'g'}
                            </Typography>
                            <Typography variant="caption" sx={{ textAlign: 'right', width: '50px' }}>
                                {percentage.toFixed(0)}%
                            </Typography>
                        </Box>
                        <LinearProgress sx={{ height: 5 }} variant="determinate" value={Math.min(percentage, 100)} color={color} />
                    </Box>
                );
            })}
            {(totalActivities?.caloriesBurned > 0 || foodItems?.length > 0) && (
                <Box sx={{ mt: isMobile ? 0.5 : 0, mb: isMobile ? -0.5 : 0, pb: 0.5, width: '120%', marginLeft: '-10%' }}>
                    <Typography variant="body2">
                        {totalActivities?.caloriesBurned > 0 && (
                            <span onClick={(e) => handleMenuOpen(e, 'activity')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                                Burned {totalActivities.caloriesBurned} cals in {activityItems.length} {activityItems.length === 1 ? 'activity' : 'activities'}
                            </span>
                        )}
                        {totalActivities?.caloriesBurned > 0 && foodItems?.length > 0 && ', '}
                        {foodItems?.length > 0 && (
                            <span onClick={(e) => handleMenuOpen(e, 'food')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                                had {foodItems.length} {foodItems.length === 1 ? 'meal' : 'meals'}
                            </span>
                        )}
                    </Typography>
                </Box>
            )}
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
                <MenuItem>
                    <ItemList items={menuType === 'food' ? foodItems : activityItems} onDelete={handleDeleteItem} />
                </MenuItem>
            </Menu>
        </Box>
    );
};

const aggregateNutrients = (items) => {
    if (!items) return {};
    const totals = items.reduce((totals, { item: { calories = 0, proteins = 0, carbs = 0, fats = 0 } }) => ({
        calories: totals.calories + calories,
        proteins: totals.proteins + proteins,
        carbs: totals.carbs + carbs,
        fats: totals.fats + fats,
    }), { calories: 0, proteins: 0, carbs: 0, fats: 0 });

    return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, parseInt(+v)]));
};

const aggregateActivities = (items) => {
    if (!items) return {};
    const totals = items.reduce((totals, { item: { caloriesBurned = 0 } }) => ({
        caloriesBurned: totals.caloriesBurned + caloriesBurned,
    }), { caloriesBurned: 0 });

    return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, parseInt(+v)]));
};

const getTimestampRangeForDate = (date) => {
    const startOfDay = new Date(date.setHours(0, 0, 0, 0)).getTime();
    const endOfDay = new Date(date.setHours(23, 59, 59, 999)).getTime();
    return [startOfDay, endOfDay];
};

const ProfileForm = ({ profile, setProfile, itemsAPI, KB, setBlockingLoading }) => {
    const [formData, setFormData] = useState(profile || {
        id: 'profile',
        goals: 'Weight Loss and Getting Fit',
        calorieDeficit: 300,
        carbPercentage: 45,
        proteinPercentage: 30,
        fatPercentage: 25
    });
    const [errors, setErrors] = useState({});
    const [totalPercentage, setTotalPercentage] = useState(100);

    useEffect(() => {
        const total = (formData.carbPercentage || 0) + (formData.proteinPercentage || 0) + (formData.fatPercentage || 0);
        setTotalPercentage(total);
    }, [formData]);

    const handleChange = (e, attr) => {
        const { name, value } = e.target;
        const parsedValue = attr?.attrType?.startsWith('float') ? parseFloat(value) : value;
        const updatedFormData = { ...formData, [name]: parsedValue };

        if (['carbPercentage', 'proteinPercentage', 'fatPercentage'].includes(name)) {
            const otherFields = ['carbPercentage', 'proteinPercentage', 'fatPercentage'].filter(field => field !== name);
            if (otherFields.every(field => updatedFormData[field])) {
                updatedFormData[otherFields[1]] = Math.max(0, 100 - parsedValue - updatedFormData[otherFields[0]]);
            }
        }

        setFormData(updatedFormData);
        setErrors({ ...errors, [name]: !parsedValue });
    }

    const attributes = KB?.itemTypes?.profile?.attributes || [];

    const handleSave = async () => {
        const newErrors = attributes.reduce((acc, { attrName }) => {
            if (!formData[attrName]) acc[attrName] = true;
            return acc;
        }, {});

        const hasError = totalPercentage !== 100;
        ['carbPercentage', 'proteinPercentage', 'fatPercentage'].forEach(attr => newErrors[attr] = hasError);
        setErrors(newErrors);

        if (Object.values(newErrors).some(Boolean)) return;

        setBlockingLoading(true);

        try {
            const action = formData?.itemId ? itemsAPI.updateItem : itemsAPI.createItem;
            const { itemId } = await action({ itemId: 'profile', itemType: 'profile', KBData: KB, attributes, item: formData });
            setProfile({ ...formData, itemId });
        } catch (e) {
            console.error(e);
        } finally {
            setBlockingLoading(false);
        }
    };

    return (
        <Box component="form" sx={{ width: '98%', display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
            <Typography variant="h4" sx={{ textAlign: 'center', mb: 1 }}>User Profile</Typography>
            {totalPercentage !== 100 && (<Typography color="error" variant="body2">The sum of percentages must equal 100.</Typography>)}
            <Grid container spacing={2}>
                {attributes.map((attr, index) => (
                    attr.attrName === 'gender' ? (
                        <Grid item xs={12} key={attr.attrName}>
                            <FormControl variant="outlined" size="small" error={errors[attr.attrName]} fullWidth>
                                <InputLabel>{attr.label}</InputLabel>
                                <Select name={attr.attrName} value={formData[attr.attrName] || ''} onChange={(e) => handleChange(e, attr)} label={attr.label}>
                                    {['male', 'female'].map(option => (
                                        <MenuItem key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                    ) : (
                        <Grid item xs={attr.unit === '%' ? 4 : 12} key={attr.attrName}>
                            <TextField
                                name={attr.attrName}
                                size="small"
                                label={attr.label}
                                placeholder={attr.placeholder}
                                value={index === 0 ? 'profile' : (formData[attr.attrName] || '')}
                                onChange={(e) => handleChange(e, attr)}
                                variant="outlined"
                                error={errors[attr.attrName]}
                                helperText={errors[attr.attrName] ? 'This field is required' : ''}
                                InputProps={{ endAdornment: attr.unit ? <InputAdornment position="end">{attr.unit}</InputAdornment> : null }}
                                fullWidth
                                sx={index === 0 ? { display: 'none' } : {}}
                            />
                        </Grid>
                    )
                ))}
            </Grid>
            <Button variant="contained" color="primary" sx={{ width: '100%', height: '40px' }} onClick={handleSave}>
                {formData?.itemId ? 'Update Profile' : 'Save Profile'}
            </Button>
        </Box>
    );
}

const Header = ({ setRenderSettings, indexedDB, itemsAPI, KB, setBlockingLoading, blockingLoading, renderSettings }) => {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [view, setView] = useState(null);
    const [profile, setProfile] = useState(null);

    const foodItems = indexedDB.useQuery(() => {
        return indexedDB?.db?.['food']?.where('updatedAt').between(...getTimestampRangeForDate(selectedDate)).toItems();
    }, [selectedDate, blockingLoading]);

    const activityItems = indexedDB.useQuery(() => {
        return indexedDB?.db?.['activity']?.where('updatedAt').between(...getTimestampRangeForDate(selectedDate)).toItems();
    }, [selectedDate, blockingLoading]);

    useEffect(() => {
        setRenderSettings({
            disableEmojiButton: true,
            disableShareButton: true,
            disableCopyButton: true,
            disableChatAvatar: true,
            disableSentLabel: true,
            disableTotalMessagesLabel: true,
            disableContextItems: true,
            disableMobileLeftButton: true,
            disableBalanceView: true,
            disableChatModelsSelect: true,
            chatContainerHeight: window.innerHeight - 355,            
        });
    }, [setRenderSettings]);

    useEffect(() => {
        const fetchProfile = async () => {
            let profileItem = (await indexedDB?.db?.['profile']?.toItems())?.[0]
            setProfile(profileItem?.item)
        };
        fetchProfile();
    }, [itemsAPI, KB]);

    const handlePreviousDay = () => setSelectedDate(new Date(selectedDate.setDate(selectedDate.getDate() - 1)));
    const handleNextDay = () => setSelectedDate(new Date(selectedDate.setDate(selectedDate.getDate() + 1)));

    if (profile === null) return null;

    return (
        <ThemeProvider theme={() => createTheme(window.openkbsTheme)}>
            <div style={{ marginTop: isMobile ? -70 : 0, width: '100%' }}>
                {profile && <IconButton style={{position: 'absolute', left: isMobile ? 16 : 310, top: 70, backgroundColor: 'rgba(0, 0, 0, 0.2)'}}
                                        onClick={() => setView(prev => prev === 'profile' ? 'bars' : 'profile')}>
                    {view === 'profile' ? <Timeline /> : <AccountCircle />}
                </IconButton>}
                {profile && view !== 'profile' && <>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, width: '80%', marginLeft: '10%' }}>
                        <IconButton onClick={handlePreviousDay}><ArrowLeft /></IconButton>
                        <Typography variant="h6" sx={{ fontSize }}>{formatDate(selectedDate)}</Typography>
                        <IconButton onClick={handleNextDay}><ArrowRight /></IconButton>
                    </Box>
                    <StatsProgressBars {...{ foodItems, activityItems, profile, setRenderSettings, renderSettings, itemsAPI, KB, setBlockingLoading }} />
                </>}
                {(!profile || view === 'profile') && <ProfileForm {...{ profile, setProfile, itemsAPI, KB, setBlockingLoading }} />}
            </div>
        </ThemeProvider>
    );
}

const exports = { Header, onRenderChatMessage, onDeleteChatMessage };
window.contentRender = exports;
export default exports;
